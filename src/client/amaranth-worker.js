import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.mjs';

const rfc3986_2_0_0 = 'https://files.pythonhosted.org/packages/ff/9a/9afaade874b2fa6c752c36f1548f718b5b83af81ed9b76628329dab81c1b/rfc3986-2.0.0-py2.py3-none-any.whl';
const jschon_0_11_1 = 'https://files.pythonhosted.org/packages/ce/b1/31f454a2ac0d23b0a47283d115f0af4abe2a1ea391f5ccb223e02d685b82/jschon-0.11.1-py3-none-any.whl';
const pyvcd_0_4_1 = 'https://files.pythonhosted.org/packages/8d/6d/24f67ec6cbe90ffca470f3c31e24f3d21124abc5b690398ab34a54bd3070/pyvcd-0.4.1-py2.py3-none-any.whl';
const amaranth_0_5_8 = 'https://files.pythonhosted.org/packages/74/4b/61caac0c0ba1934ed839ddfa35592e3cbc2a6762e829209df5e8adab4fda/amaranth-0.5.8-py3-none-any.whl';

const pythonPackages = [rfc3986_2_0_0, jschon_0_11_1, pyvcd_0_4_1, amaranth_0_5_8];

const pythonHelperScript = `
import sys
import os
import importlib.util

from amaranth.back import rtlil

def process_modules(filenames):
    """
    Executes a list of flat filenames (e.g. ['utils.py', 'top.py'])
    Returns: { 'top.il': ['rtlil...'] } or single string when exception occurs
    """

    try:
        # Ensure current dir is in sys.path
        cwd = os.getcwd()
        if cwd not in sys.path:
            sys.path.insert(0, cwd)

        results = {}

        for filename in filenames:
            if not filename.endswith(".py"):
                continue

            module_name = filename[:-3] # "utils.py" -> "utils"
            output_filename = f'{module_name}.il'

            try:
                # Dynamic import
                spec = importlib.util.spec_from_file_location(module_name, filename)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    sys.modules[module_name] = module
                    spec.loader.exec_module(module)

                    if hasattr(module, "exports"):
                        exports = module.exports
                        exported_rtlils = None

                        if isinstance(exports, list):        # list of rtlil code strings
                            exported_rtlils = [str(x) for x in res]
                        elif isinstance(exports, str):       # single rtlil code string
                            exported_rtlils = [str(res)]
                        elif isinstance(exports, dict):      # dict of name -> module data
                            exported_rtlils = []
                            for name, obj in exports.items():
                                try:
                                    module_instance = obj['module']
                                    exported = rtlil.convert(
                                        module_instance,
                                        name=name,
                                        ports=obj.get('ports', None),
                                    )
                                    exported_rtlils.append(exported)
                                except Exception as e:
                                    raise Exception(f"Malformed export entry for {name}. {e}")
                        else:
                            raise Exception(f"Unsupported exports type: {type(exports)}")

                        results[output_filename] = exported_rtlils

            except Exception as e:
                raise Exception(f"Error processing {filename}: {e}")

        return results
    except Exception as e:
        return str(e)

def clear_module_cache(filenames):
    """
    Removes the specific modules we just created from sys.modules
    so the next run doesn't use stale code.
    """
    for filename in filenames:
        if filename.endswith(".py"):
            mod_name = filename[:-3]
            if mod_name in sys.modules:
                del sys.modules[mod_name]
`;

const pythonUtils = `
def mod(module, ports=None):
    return (
        {"module": module}
        if ports is None
        else {
            "module": module,
            "ports": ports,
        }
    )


def export(**modules):
    return modules
`

let pyodide = null;
async function loadPythonEnviroment() {
    if (pyodide === null) {
        pyodide = await loadPyodide();
        await pyodide.loadPackage(pythonPackages);

        pyodide.FS.mkdir("digitaljs");
        pyodide.FS.writeFile('digitaljs/utils.py', pythonUtils);

        await pyodide.runPythonAsync(pythonHelperScript);
    }
    return pyodide;
}

const initializationPromise = loadPythonEnviroment();

async function convertAmaranthToRtlil(pythonFiles) {
    const filenames = Object.keys(pythonFiles);
    try {
        filenames.forEach((filename) => {
            pyodide.FS.writeFile(filename, pythonFiles[filename]);
        });

        const processFunc = pyodide.globals.get("process_modules");
        const resultProxy = processFunc(filenames);

        if (typeof resultProxy === 'string') {
            throw new Error(resultProxy);
        }

        const convertedIlFiles = resultProxy.toJs();
        resultProxy.destroy();

        Object.keys(convertedIlFiles).forEach(filename => {
            convertedIlFiles[filename] = convertedIlFiles[filename].join('\n');
        })

        return convertedIlFiles;
    } finally {
        try {
            const clearFunc = pyodide.globals.get("clear_module_cache");
            clearFunc(filenames);
            clearFunc.destroy();
        } catch(e) { console.error("Cache cleanup error", e); }

        for (const path of filenames) {
            try { pyodide.FS.unlink(path); } catch(e) { }
        }
    }
}

self.onmessage = async (e) => {
    const {type, params } = e.data;
    if (type === 'convertAmaranth') {
        const { files } = params
        try {
            const pythonFiles = {};
            const otherFiles = {};

            Object.entries(files).forEach(([filename, content]) => {
                if (filename.endsWith('.py')) {
                    pythonFiles[filename] = content;
                } else {
                    otherFiles[filename] = content;
                }
            });

            await initializationPromise;
            const convertedPythonFiles = await convertAmaranthToRtlil(pythonFiles);

            const resultFiles = {...otherFiles, ...convertedPythonFiles};
            self.postMessage({type: 'pythonConversionFinished', output: {type: 'success', files: resultFiles}});
        } catch (err) {
            self.postMessage({type: 'pythonConversionFinished', output: {type: 'error', message: 'Amaranth conversion failed', details: err.message || String(err)}});
        }
    } else {
        throw new Error(`[Amaranth Worker] Unexpected message ${(e.data).type}`);
    }
}

self.onerror = (event) => {
    console.error('[Amaranth Worker] Failure', event);
};

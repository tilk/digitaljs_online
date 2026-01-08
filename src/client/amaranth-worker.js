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
from contextlib import contextmanager

from amaranth.back import rtlil

from digitaljs.utils import get_registry, clear_registry

@contextmanager
def add_path(path):
    if path not in sys.path:
        sys.path.insert(0, path)
        yield
        try:
            sys.path.remove(path)
        except ValueError:
            pass
    else:
        yield

def process_modules(filenames):
    results = {}

    try:
        with add_path(os.getcwd()):
            for filename in filenames:
                if not filename.endswith(".py"):
                    continue

                module_name = filename[:-3]
                output_filename = f'{module_name}.il'

                clear_registry()

                spec = importlib.util.spec_from_file_location(module_name, filename)
                if not spec or not spec.loader:
                    raise ImportError(f"Could not load {filename}")

                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)

                exports = get_registry()

                # Check for duplicate names
                seen_names = set()
                for entry in exports:
                    name = entry['name']
                    if name in seen_names:
                        raise ValueError(f"Duplicate module name detected: '{name}'. Try to use the 'suffix' parameter of the @export decorator to disambiguate.")
                    seen_names.add(name)

                # Perform conversion
                exported_rtlils = []
                for entry in exports:
                    target = entry['target']
                    name = entry['name']
                    kwargs = entry['kwargs']
                    ports_setting = entry['ports']

                    instance = target(**kwargs)

                    ports = ports_setting(instance) if callable(ports_setting) else ports_setting

                    code = rtlil.convert(
                        instance,
                        name=name,
                        ports=ports
                    )
                    exported_rtlils.append(code)

                results[output_filename] = exported_rtlils
        return results
    except Exception as e:
        return str(e)
    finally:
        clear_module_cache(filenames)

def clear_module_cache(filenames):
    PROTECTED_MODULES = {'sys', 'os', 'math', 're', 'amaranth'}

    for filename in filenames:
        if filename.endswith(".py"):
            mod_name = filename[:-3]

            if mod_name in sys.modules and mod_name not in PROTECTED_MODULES:
                del sys.modules[mod_name]
`;

const pythonUtils = `
import inspect

_registry = []

def export(target=None, *, name=None, suffix=None, ports=None, **kwargs):
    def wrapper(inner_target):
        base_name = name or inner_target.__name__

        final_suffix = ""
        if suffix:
            final_suffix = suffix
        elif name is None and kwargs:
            parts = [f"_{k}_{v}" for k, v in sorted(kwargs.items())]
            final_suffix = "".join(parts)

        final_name = f"{base_name}{final_suffix}"

        _registry.append({
            "target": inner_target,
            "name": final_name,
            "ports": ports,
            "kwargs": kwargs
        })

        return inner_target

    if target is not None:
        if inspect.isclass(target) or callable(target):
            return wrapper(target)

    return wrapper

def get_registry():
    return _registry

def clear_registry():
    _registry.clear()
`

let pyodide = null;
async function loadPythonEnviroment() {
    if (pyodide === null) {
        console.log('[Amaranth Worker]: Loading enviroment...')
        pyodide = await loadPyodide({
            packages: pythonPackages,
            stderr: (_) => {},
            stdout: (_) => {}
        });

        pyodide.FS.mkdir("digitaljs");
        pyodide.FS.writeFile('digitaljs/utils.py', pythonUtils);

        await pyodide.runPythonAsync(pythonHelperScript);

        console.log('[Amaranth Worker]: Enviroment ready')
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

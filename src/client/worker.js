import { runYosys, Exit as YosysExit } from 'https://cdn.jsdelivr.net/npm/@yowasp/yosys/gen/bundle.js';
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.mjs';
import { loadVerilator, getWASMMemory, getVerilatorFactory, moduleInstFn } from './verilator-loader.js';
import { yosys2digitaljs, io_ui, prepare_yosys_script, prepare_verilator_args } from 'yosys2digitaljs/core';

class StreamCollector {
    constructor() {
        this.chunks = [];
        this.totalLength = 0;
    }

    push(chunk) {
        this.chunks.push(chunk);
        this.totalLength += chunk.length;
    }

    toString() {
        const result = new Uint8Array(this.totalLength);
        let offset = 0;
        for (const chunk of this.chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder().decode(result);
    }
}

function pathBasename(path) {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1];
}

function loadYosysRuntime() {
    const opts = {
        fetchProgress: () => {},
        stdout: data => {},
        stderr: data => {},
        synchronously: false
    }

    return runYosys([], {}, opts);
}

function loadVerilatorRuntime() {
    return loadVerilator();
}

let pyodide = null;
const pythonHelperScript = `
import sys
import os
import importlib.util

from amaranth.back import verilog

def process_modules(filenames):
    """
    Executes a list of flat filenames (e.g. ['utils.py', 'top.py'])
    Returns: { 'top.py': ['verilog...'] }
    """

    # Ensure current dir is in sys.path
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    results = {}

    for filename in filenames:
        if not filename.endswith(".py"):
            continue

        module_name = filename[:-3] # "utils.py" -> "utils"

        try:
            # Dynamic import
            spec = importlib.util.spec_from_file_location(module_name, filename)
            if spec and spec.loader:
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)

                if hasattr(module, "exports"):
                    verilog_exports = []
                    for name, obj in module.exports.items():
                        try:
                            module_instance = obj['module']
                            exported = verilog.convert(
                                module_instance,
                                name=name,
                                ports=obj.get('ports', None),
                            )
                            verilog_exports.append(exported)
                        except Exception as e:
                            verilog_exports.append(f"// Error exporting {name}: {e}")

                    results[filename] = [str(v) for v in verilog_exports]
                elif hasattr(module, "verilog_result"):
                    res = module.verilog_result
                    # Ensure we always return a list of strings
                    if isinstance(res, list):
                        results[filename] = [str(x) for x in res]
                    else:
                        results[filename] = [str(res)]

        except Exception as e:
            results[filename] = [f"// Error processing {filename}: {e}"]

    return results

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

async function loadPythonEnviroment() {
    if (pyodide === null) {
        globalThis.runAmaranthYosys = (args, stdinText) => {
            let stdin = new TextEncoder().encode(stdinText);
            const stdout = [];
            const stderr = [];
            try {
                runYosys(args.toJs(), {}, {
                    stdin: (length) => {
                        if (stdin.length === 0) return null;
                        let chunk = stdin.subarray(0, length);
                        stdin = stdin.subarray(length);
                        return chunk;
                    },
                    stdout: data => data ? stdout.push(new TextDecoder().decode(data)) : null,
                    stderr: data => data ? stderr.push(new TextDecoder().decode(data)) : null,
                    synchronously: true,
                });
                return [0, stdout.join(''), stderr.join('')];
            } catch(e) {
                if (e instanceof YosysExit) return [e.code, stdout.join(''), stderr.join('')];
                throw e;
            } finally {
                if (args?.destroy) args.destroy();
            }
        }

        pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.0/full/",
            env: {
                HOME: '/',
                AMARANTH_USE_YOSYS: 'javascript',
            }
        });

        await pyodide.loadPackage("micropip");
        const micropip = pyodide.pyimport("micropip");

        // TODO: This cause the yosys to be downloaded again. Find how to avoid that.
        // Check the amaranth playground repo for reference.
        await micropip.install(["amaranth"]);
        await pyodide.runPythonAsync(pythonHelperScript);
    }
    return pyodide;
}

const initializationPromise = Promise.all([
    loadYosysRuntime(),
    loadVerilatorRuntime(),
    loadPythonEnviroment()
]).then(() => {
    console.log('[Worker] Environment ready (Yosys + Verilator)');
}).catch(err => {
    console.error('[Worker] Initialization failed', err);
});

async function runYosysOnFiles(files, options) {
    const YOSYS_OUTPUT = 'output.json';

    const stdoutCollector = new StreamCollector();
    const stderrCollector = new StreamCollector();

    try {
        const filenames = Object.keys(files);
        const yosysArgs = ['-p', prepare_yosys_script(filenames, options), '-o', YOSYS_OUTPUT];

        const result = runYosys(yosysArgs, files, {
            stdout: data => data ? stdoutCollector.push(data) : null,
            stderr: data => data ? stderrCollector.push(data) : null,
            synchronously: true,
        });
        const yosysJson = JSON.parse(result[YOSYS_OUTPUT]);
        return [0, yosysJson, stdoutCollector.toString(), stderrCollector.toString()];
    } catch (e) {
        if (e instanceof YosysExit) {
            return [e.code, {}, stdoutCollector.toString(), stderrCollector.toString()];
        } else {
            throw e;
        }
    }
}

async function runVerilatorOnFiles(files) {
    try {
        const stdoutCollector = [];
        const stderrCollector = [];

        const verilatorFactory = getVerilatorFactory();
        const verilator = await verilatorFactory({
            instantiateWasm: moduleInstFn(),
            noInitialRun: true,
            noExitRuntime: true,
            print: (s) => { stdoutCollector.push(s); },
            printErr: (s) => { stderrCollector.push(s); },
            wasmMemory: getWASMMemory(),
        });

        const filenames = Object.keys(files);

        filenames.forEach((filename) => {
            verilator.FS.writeFile(filename, files[filename]);
        });

        const args = prepare_verilator_args(filenames);
        verilator.callMain(args);

        const lintLines = stderrCollector.length > 0 ? stderrCollector.slice(0, -1) : [];
        const verilator_re = /^%(Warning|Error)[^:]*: ([^:]*):([0-9]+):([0-9]+): (.*)$/;

        const lint = lintLines
            .map(line => line.match(verilator_re))
            .filter(result => result != null)
            .map(result => {
                return {
                    type: result[1],
                    file: pathBasename(result[2]),
                    line: Number(result[3]),
                    column: Number(result[4]),
                    message: result[5]
                }
            });

        return lint;
    } catch (e) {
        console.error('[Worker] Verilator linting failed', e);
        return [];
    }
}

async function convertAmaranthToVerilog(pythonFiles) {
    const filenames = Object.keys(pythonFiles);

    try {
        filenames.forEach((filename) => {
            pyodide.FS.writeFile(filename, pythonFiles[filename]);
        });

        const processFunc = pyodide.globals.get("process_modules");
        const resultProxy = processFunc(filenames);
        const result = resultProxy.toJs();
        resultProxy.destroy();

        const convertedFiles = Object.entries(result)
            .reduce((files, [filename, verilogList]) => {
                files[filename.replace('.py', '.v')] = verilogList.join('\n');
                return files;
            }, {});

        return convertedFiles;
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

    if (type === 'synthesizeAndLint') {
        const { files, options } = params;
        try {
            await initializationPromise;

            const lintPromise = options.lint ? runVerilatorOnFiles(files) : Promise.resolve([]);
            const synthesisPromise = runYosysOnFiles(files, options);

            const [lint, [yosysExit, yosysResult, ystdout, ystderr]] = await Promise.all([lintPromise, synthesisPromise]);

            let circuit = undefined;
            if (yosysExit === 0) {
                circuit = yosys2digitaljs(yosysResult, options);
                io_ui(circuit);
            }

            const synthesisResult = yosysExit === 0
            ? {
                type: 'success',
                result: circuit
            } : {
                type: 'failure',
                message: 'Yosys synthesis failed',
                exitCode: yosysExit,
                stdout: ystdout,
                stderr: ystderr
            }

            self.postMessage({type: 'synthesisFinished', output: synthesisResult, lint: lint});
        } catch (err) {
            self.postMessage({type: 'synthesisFinished', output: {type: 'error', message: err.message || String(err)} , lint: []});
        }
    } else if (type === 'convertAmaranth') {
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
            const convertedPythonFiles = await convertAmaranthToVerilog(pythonFiles);

            console.log(convertedPythonFiles);

            const resultFiles = {...otherFiles, ...convertedPythonFiles};
            self.postMessage({type: 'pythonConversionFinished', output: {type: 'success', files: resultFiles}});
        } catch (err) {
            self.postMessage({type: 'pythonConversionFinished', output: {type: 'error', message: err.message || String(err)}});
        }
    } else {
        throw new Error(`[Worker] Unexpected message ${(e.data).type}`);
    }
}

self.onerror = (event) => {
    console.error('[Worker] Failure', event);
};

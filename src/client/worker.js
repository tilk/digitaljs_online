import { runYosys, Exit as YosysExit } from 'https://cdn.jsdelivr.net/npm/@yowasp/yosys/gen/bundle.js';
import { loadVerilator, getWASMMemory, getVerilatorGlue, moduleInstFn } from './verilator-loader.js';
import { yosys2digitaljs, io_ui } from 'yosys2digitaljs/core';

const YOSYS_FILES = {
    SCRIPT: 'script.ys',
    OUTPUT: 'output.json'
};

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

const initializationPromise = Promise.all([
    loadYosysRuntime(),
    loadVerilatorRuntime()
]).then(() => {
    console.log('[Worker] Environment ready (Yosys + Verilator)');
}).catch(err => {
    console.error('[Worker] Initialization failed', err);
});


function prepareYosysScript(files, options) {
    const optimize_simp = options.optimize ? "opt" : "opt_clean";
    const optimize = options.optimize ? "; opt -full" : "; opt_clean";
    const fsmexpand = options.fsmexpand ? " -expand" : "";
    const fsmpass = options.fsm == "nomap" ? "; fsm -nomap" + fsmexpand
                : options.fsm ? "; fsm" + fsmexpand
                : "";

    const readVerilogFilesScript = Object.keys(files)
        .map(filename => `read_verilog -sv ${filename}`)
        .join('\n');

    const yosysScript = `
${readVerilogFilesScript}
hierarchy -auto-top
proc
${optimize_simp}
${fsmpass}
memory -nomap
wreduce -memx
${optimize}
write_json ${YOSYS_FILES.OUTPUT}
`;
    return yosysScript;
}

async function runYosysOnFiles(files, options) {
    const stdoutCollector = new StreamCollector();
    const stderrCollector = new StreamCollector();

    try {
        const synthesisFiles = {
            ...files,
            [YOSYS_FILES.SCRIPT]: prepareYosysScript(files, options),
        }

        const result = runYosys(['-s', YOSYS_FILES.SCRIPT], synthesisFiles, {
            stdout: data => data ? stdoutCollector.push(data) : null,
            stderr: data => data ? stderrCollector.push(data) : null,
            synchronously: true,
        });
        const yosysJson = JSON.parse(result[YOSYS_FILES.OUTPUT]);
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

        const verilatorFactory = getVerilatorGlue();

        const verilatorMod = verilatorFactory({
            instantiateWasm: moduleInstFn(),
            noInitialRun: true,
            noExitRuntime: true,
            print: (s) => { stdoutCollector.push(s); },
            printErr: (s) => { stderrCollector.push(s); },
            wasmMemory: getWASMMemory(),
        });

        const filenames = Object.keys(files);

        filenames.forEach((filename) => {
            verilatorMod.FS.writeFile(filename, files[filename]);
        });

        const args = ['--lint-only', '--Wall', '-Wno-DECLFILENAME', '-Wno-UNOPT', '-Wno-UNOPTFLAT'].concat(filenames);
        const mainFn = verilatorMod.callMain || verilatorMod.run;
        mainFn(args);

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
        return [];
    }
}

self.onmessage = async (e) => {
    const {type, files, options} = e.data;

    if (type === 'synthesizeAndLint') {
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
    } else {
        throw new Error(`[Worker] Unexpected message ${(e.data).type}`);
    }
}

self.onerror = (event) => {
    console.error('[Worker] Failure', event);
};

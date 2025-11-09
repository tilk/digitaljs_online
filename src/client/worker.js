import { runYosys, Exit as YosysExit } from 'https://cdn.jsdelivr.net/npm/@yowasp/yosys/gen/bundle.js';

class StreamCollector {
	constructor() {
		this.chunks = [];
		this.totalLength = 0;
	}
1
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

const yosysPseudoFileName = 'script.ys'
const yosysOutputPseudoFileName = 'output.json';

function prepareYosysScript(files, options) {
		console.log('[Worker] Preparing Yosys script for files', Object.keys(files), 'with options', options);

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
write_json ${yosysOutputPseudoFileName}
`;
		return yosysScript;
}

const yosysPromise = runYosys().then(() => {
	console.log('[Worker] Preloaded Yosys');
});

async function runYosysOnFiles(files, options) {
	const stdoutCollector = new StreamCollector();
	const stderrCollector = new StreamCollector();

	try {
		files[yosysPseudoFileName] = prepareYosysScript(files, options);


		await yosysPromise;
		const result = runYosys(['-s', yosysPseudoFileName], files, {
			stdout: data => data ? stdoutCollector.push(data) : null,
			stderr: data => data ? stderrCollector.push(data) : null,
			synchronously: true,
		});
		console.log('[Worker] Yosys finished', result);
		const yosysJson = JSON.parse(result[yosysOutputPseudoFileName]);
		return [0, yosysJson, stdoutCollector.toString(), stderrCollector.toString()];
	} catch (e) {
		if (e instanceof YosysExit) {
			return [e.code, {}, stdoutCollector.toString(), stdoutCollector.toString()];
		} else {
			throw e;
		}
	}
}

self.onmessage = async (e) => {
	console.log('[Worker] Received', e.data);
	if (e.data.type === 'synthesize') {
		const [yosisExit, yosysResult, stdout, stderr] = await runYosysOnFiles(e.data.files, e.data.options);
		if (yosisExit === 0) {
			self.postMessage({type: 'result', output: yosysResult});
		} else {
			self.postMessage({type: 'error', message: 'Yosys synthesis failed', yosys_stdout: stdout, yosys_stderr: stderr});
		}
	} else {
		throw new Error(`[Worker] Unexpected message ${(e.data).type}`);
	}
}

self.onerror = (event) => {
	console.error('[Worker] Failure', event);
};
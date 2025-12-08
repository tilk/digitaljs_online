// Memory part
let wasmMemory = null;
export function getWASMMemory() {
  if (wasmMemory === null) {
    wasmMemory = new WebAssembly.Memory({
      'initial': 1024,  // 64MB
      'maximum': 16384, // 1024MB
    });
  }
  return wasmMemory;
}


let verilatorLoaded = false;
let verilatorBlob = null;
export async function loadVerilatorWasmBinary() {
	if (verilatorLoaded) return;
	const url = 'verilator_bin.wasm';
	const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load WASM file verilator_bin.wasm: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    verilatorBlob = new Uint8Array(buffer);
    console.log(`Loaded verilator_bin.wasm (${verilatorBlob.length} bytes)`);
    verilatorLoaded = true;
}

// hacky way to load verilator glue as it is not a module
// we won't load it often anyway
// separate linting worker should solve this issue
async function loadVerilatorGlue() {
  const src = await fetch('/verilator_bin.js').then(r => r.text());
  self.verilator_bin = new Function(src + '; return verilator_bin;')();
}

export async function loadVerilator() {
	if (verilatorLoaded) return;
	await loadVerilatorGlue();
	await loadVerilatorWasmBinary();
}

// Verilator WASM module caching and creation part
let verilator_wasm_cache = null;
let CACHE_WASM_MODULES = true;

export function getWASMModule() {
  if (verilator_wasm_cache === null) {
    const verilator_wasm = new WebAssembly.Module(verilatorBlob);
    if (CACHE_WASM_MODULES) {
      verilator_wasm_cache = verilator_wasm;
    }
	return verilator_wasm;
  }
  return verilator_wasm_cache;
}

export function moduleInstFn() {
  return function (imports, ri) {
    let mod = getWASMModule();
    let inst = new WebAssembly.Instance(mod, imports);
    ri(inst);
    return inst.exports;
  }
}

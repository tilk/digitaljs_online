const MEMORY_CONFIG = {
    initial: 1024,  // 64MB
    maximum: 16384, // 1024MB
};

const FILES = {
    WASM: 'verilator_bin.wasm',
    GLUE: '/verilator_bin.js',
};

class VerilatorManager {
    constructor() {
        this.memory = null;
        this.moduleCache = null;
        this.glueFn = null;

        this.loadPromise = null;
    }

    getMemory() {
        if (!this.memory) {
            this.memory = new WebAssembly.Memory(MEMORY_CONFIG);
        }
        return this.memory;
    }

    async load() {
        if (this.moduleCache && this.glueFn) return;
        if (this.loadPromise) return this.loadPromise;

        this.loadPromise = Promise.all([
            this._loadWasmModule(),
            this._loadGlueCode()
        ]).finally(() => {
            this.loadPromise = null;
        });

        await this.loadPromise;
    }

    async _loadWasmModule() {
        if (this.moduleCache) return;

        const response = await fetch(FILES.WASM);
        if (!response.ok) {
            throw new Error(`Failed to load WASM file ${FILES.WASM}: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        this.moduleCache = await WebAssembly.compile(buffer);
    }

    async _loadGlueCode() {
        if (this.glueFn) return;

        const src = await fetch(FILES.GLUE).then(r => r.text());

        this.glueFn = new Function(`${src}; return verilator_bin;`)();
    }


    getModuleInstantiator() {
        return (imports, receiveInstanceCallback) => {
            if (!this.moduleCache) {
                throw new Error("Verilator WASM module not loaded. Call loadVerilator() first.");
            }

            const instance = new WebAssembly.Instance(this.moduleCache, imports);

            receiveInstanceCallback(instance);
            return instance.exports;
        };
    }
}

const verilatorManager = new VerilatorManager();

export function getWASMMemory() {
    return verilatorManager.getMemory();
}

export function loadVerilator() {
    return verilatorManager.load();
}

export function getWASMModule() {
    return verilatorManager.moduleCache;
}

export function getVerilatorGlue() {
  return verilatorManager.glueFn;
}

export function moduleInstFn() {
    return verilatorManager.getModuleInstantiator();
}
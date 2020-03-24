const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const util = require('util');
const app = express();
const yosys2digitaljs = require('yosys2digitaljs');
const sqlite = require('sqlite');
const SQL = require('sql-template-strings');
const sha256 = require('js-sha256');

const mkdir = util.promisify(fs.mkdir);
const writeFile = util.promisify(fs.writeFile);
const readFile = util.promisify(fs.readFile);
const readdir = util.promisify(fs.readdir);
const rmdir = util.promisify(require('rimraf'));
const exec = util.promisify(require('child_process').exec);

function genRandomPath() {
    return 'xxxxxxxxxxxxxxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

async function handleClash(files, yosys_opts) {
    const prj_path = './' + genRandomPath();

    await mkdir(prj_path);

    for (const fn of Object.keys(files)) {
        await writeFile(prj_path + "/" + "main.hs", files[fn]);
    }

    try {
        await exec(`( cd ${prj_path} ; clash main.hs --verilog )`);
    } catch(ret) {
        await rmdir(prj_path);
        throw {
            step: "HDL_compilation",
            error: "Error running clash compiler on files.",
            hdl_stdout: ret.stdout,
            hdl_stderr: ret.stderr
        };
    }

    const out_files = {};

    try {
        const out_path = `${prj_path}/verilog`;
        const project = await readdir(out_path);
        const verilog_path = `${out_path}/${project[0]}`
        const fileNames = await readdir(verilog_path);

        const out_files = {};

        for (const f of fileNames) {
            out_files[f] = await readFile(`${verilog_path}/${f}`, 'utf8');
        }
    } finally {
        await rmdir(prj_path);
    }

    return [out_files, yosys_opts];
}

const languages = {
    'systemverilog': async (files, opts) => [files, opts],
    'clash' : handleClash
};

Promise.resolve((async () => {
    const db = await sqlite.open('./database.sqlite', { Promise });
    await db.migrate(); // ({ force: 'last' });

    app.use(bodyParser.json({limit: '50mb'}));

    app.get('/api/languages', async (req, res) => res.status(200).json({
        languages: Object.keys(languages)
    }));

    app.post('/api/:hdl/yosys2digitaljs', async (req, res) => {
        const lang_handler = languages[req.params['hdl']]
        if (!lang_handler) {
            return res.status(400).json({
                error: req.params['hdl'] + " is not supported.",
            });
        }

        let processed_files, processed_opts;

        try {
            [processed_files, processed_opts] = await lang_handler(req.body.files, req.body.options);
        } catch(ret) {
            return res.status(500).json({
                step: "HDL_compilation",
                error: ret.message,
                hdl_stdout: ret.stdout,
                hdl_stderr: ret.stderr
            });
        }

        try {
            const data = await yosys2digitaljs.process_files(processed_files, processed_opts);
            console.log(data);
            yosys2digitaljs.io_ui(data.output);
            console.log("blablub");
            return res.json(data);
        } catch(ret) {
            return res.status(500).json({
                step: "yosys",
                error: ret.message,
                yosys_stdout: ret.yosys_stdout,
                yosys_stderr: ret.yosys_stderr
            });
        }
    });

    app.post('/api/storeCircuit', async (req, res) => {
        try {
            // TODO verify if we got a JSON circuit
            const data = req.body;
            const sdata = JSON.stringify(data);
            const hash = sha256(sdata);
            const stmt = await db.run(SQL`UPDATE storedCircuits SET lastAccess=datetime('now') WHERE hash=${hash}`);
            if (stmt.changes == 0) {
                await db.run(SQL`INSERT INTO storedCircuits(hash, json, date, lastAccess) VALUES(${hash}, ${sdata}, datetime('now'), datetime('now'))`);
            }
//          await db.exec('INSERT INTO storedCircuits(hash, json, date, lastAccess) VALUES(?, ?, datetime("now"), datetime("now"))', hash, sdata);
            return res.json(hash);
        } catch(ret) {
            return res.status(500).json({error: 'Store failed', messages: String(ret)});
        }
    });

    app.get('/api/circuit/:hash', async (req, res) => {
        try {
            const data = await db.get(SQL`SELECT json FROM storedCircuits WHERE hash=${req.params.hash}`);
            if (data === undefined)
                return res.status(404).json({error: 'Circuit not found'});
            return res.json(JSON.parse(data.json));
        } catch(ret) {
            return res.status(500).json({error: 'Store failed', messages: String(ret)});
        }
    });

    app.listen(8080, 'localhost');
})());



const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const digital_babel = require('digital_babel');
const sqlite = require('sqlite');
const SQL = require('sql-template-strings');
const sha256 = require('js-sha256');

Promise.resolve((async () => {
    const db = await sqlite.open('./database.sqlite', { Promise });
    const converter = new digital_babel.DigitalBabel({});
    await db.migrate(); // ({ force: 'last' });

    app.use(bodyParser.json({limit: '50mb'}));

    app.post('/api/yosys2digitaljs', async (req, res) => {
        try {
            const data = await converter.convertWithOpts(req.body.files, req.body.options);
            return res.json(data);
        } catch(ret) {
            return res.status(500).json({
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



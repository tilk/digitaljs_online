"use strict";

import 'bootstrap';
import './scss/app.scss';
import 'codemirror/mode/verilog/verilog';
import 'codemirror/lib/codemirror.css';
import CodeMirror from 'codemirror/lib/codemirror';
import $ from 'jquery';
import * as digitaljs from 'digitaljs';

const examples = [
    ['sr_gate.sv', 'SR latch'],
    ['cycleadder_arst.sv', 'Accumulating adder'],
    ['fulladder.sv', 'Full adder'],
    ['serialadder.sv', 'Serial adder'],
    ['rom.sv', 'ROM'],
    ['ram.sv', 'RAM'],
];

$(window).on('load', () => {
const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
    lineNumbers: true,
    mode: {
        name: 'verilog'
    }
});

for (const [file, name] of examples) {
    $('<a class="dropdown-item" href="">').text(name).appendTo($('#excodes')).click((e) => {
        e.preventDefault();
        $.get('/examples/' + file, (data, status) => {
            editor.setValue(data);
        });
    });
}

let circuit, paper, filedata, filenum;

function runquery() {
    const data = {'_input.sv': editor.getValue()};
    for (const [filename, file] of Object.entries(filedata)) {
        data[filename] = file.result;
    }
    if (circuit) {
        circuit.shutdown();
        circuit = undefined;
    }
    if (paper) {
        paper.remove();
        paper = undefined;
    }
    $.ajax({
        type: 'POST',
        url: '/api/yosys2digitaljs',
        contentType: "application/json",
        data: JSON.stringify(data),
        dataType: 'json',
        success: (responseData, status, xhr) => {
            $('form').find('input, textarea, button, select').removeAttr('disabled');
            circuit = new digitaljs.Circuit(responseData.output);
            paper = circuit.displayOn($('<div>').appendTo($('#paper')));
        },
        error: (request, status, error) => {
            $('form').find('input, textarea, button, select').removeAttr('disabled');
            $('<div class="alert alert-danger alert-dismissible fade show" role="alert"></div>')
                .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
                .append(document.createTextNode(request.responseJSON.error))
                .append($("<pre>").text(request.responseJSON.messages.stderr.trim()))
                .insertBefore($('#paper'))
                .alert();
        }
    });
}

$('button[type=submit]').click(e => {
    e.preventDefault();
    $('form').find('input, textarea, button, select').attr('disabled', 'disabled');
    filedata = {};
    filenum = document.getElementById('files').files.length;
    for (const file of document.getElementById('files').files) {
        const reader = filedata[file.name] = new FileReader();
        reader.onload = x => {
            if (--filenum == 0) runquery();
        };
        reader.readAsText(file);
    }
    if (filenum == 0) runquery();
})

});


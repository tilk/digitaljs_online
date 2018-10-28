"use strict";

import 'popper.js';
import 'bootstrap';
import ClipboardJS from 'clipboard';
import './scss/app.scss';
import 'codemirror/mode/verilog/verilog';
import 'codemirror/lib/codemirror.css';
import CodeMirror from 'codemirror/lib/codemirror';
import $ from 'jquery';
import * as digitaljs from 'digitaljs';
import Split from 'split.js';
import { saveAs } from 'file-saver';

const examples = [
    ['sr_gate.sv', 'SR latch'],
    ['sr_neg_gate.sv', 'SR latch (negated inputs)'],
    ['dlatch_gate.sv', 'D latch'],
    ['dff_masterslave.sv', 'D flip-flop (master-slave)'],
    ['fulladder.sv', 'Full adder'],
    ['serialadder.sv', 'Serial adder'],
    ['cycleadder_arst.sv', 'Accumulating adder'],
    ['prio_encoder.sv', 'Priority encoder'],
    ['lfsr.sv', 'Linear-feedback shift register'],
    ['rom.sv', 'ROM'],
    ['ram.sv', 'RAM'],
];

$(window).on('load', () => {

Split(['#editor', '#paper'], {
    sizes: [50, 50],
    minSize: 200
});

const vsplit = Split(['#cont', '#monitorbox'], {
    sizes: [100, 0],
    minSize: 0,
    direction: 'vertical'
});

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

let loading = false, circuit, paper, monitor, monitorview, filedata, filenum;

function updatebuttons() {
    if (circuit == undefined) {
        $('#toolbar').find('button').prop('disabled', true);
        if (!loading) $('#toolbar').find('button[name=load]').prop('disabled', false);
        return;
    }
    $('#toolbar').find('button[name=load]').prop('disabled', false);
    $('#toolbar').find('button[name=save]').prop('disabled', false);
    $('#toolbar').find('button[name=link]').prop('disabled', false);
    const running = circuit.running;
    $('#toolbar').find('button[name=pause]').prop('disabled', !running);
    $('#toolbar').find('button[name=resume]').prop('disabled', running);
    $('#toolbar').find('button[name=single]').prop('disabled', running);
    $('#toolbar').find('button[name=next]').prop('disabled', running || !circuit.hasPendingEvents);
    monitorview.autoredraw = !running;
}

function destroycircuit() {
    if (circuit) {
        circuit.shutdown();
        circuit = undefined;
    }
    if (paper) {
        paper.remove();
        paper = undefined;
    }
    if (monitorview) {
        monitorview.shutdown();
        monitorview = undefined;
    }
    if (monitor) {
        monitor.stopListening();
        monitor = undefined;
    }
    loading = true;
    updatebuttons();
    $('#monitorbox button').prop('disabled', true).off();
}

function mkcircuit(data) {
    loading = false;
    $('form').find('input, textarea, button, select').prop('disabled', false);
    circuit = new digitaljs.Circuit(data);
    circuit.on('userChange', () => {
        updatebuttons();
    });
    circuit.on('postUpdateGates', (tick) => {
        $('#tick').val(tick);
    });
    circuit.start();
    monitor = new digitaljs.Monitor(circuit);
    monitorview = new digitaljs.MonitorView({model: monitor, el: $('#monitor') });
    paper = circuit.displayOn($('<div>').appendTo($('#paper')));
    updatebuttons();
    $('#monitorbox button').prop('disabled', false);
    $('#monitorbox button[name=ppt_up]').on('click', (e) => { monitorview.pixelsPerTick *= 2; });
    $('#monitorbox button[name=ppt_down]').on('click', (e) => { monitorview.pixelsPerTick /= 2; });
    $('#monitorbox button[name=left]').on('click', (e) => { 
        monitorview.live = false; monitorview.start -= monitorview.width / monitorview.pixelsPerTick / 4;
    });
    $('#monitorbox button[name=right]').on('click', (e) => { 
        monitorview.live = false; monitorview.start += monitorview.width / monitorview.pixelsPerTick / 4;
    });
    $('#monitorbox button[name=live]')
        .toggleClass('active', monitorview.live)
        .on('click', (e) => { 
            monitorview.live = !monitorview.live;
            if (monitorview.live) monitorview.start = circuit.tick - monitorview.width / monitorview.pixelsPerTick;
        });
    monitorview.on('change:live', (live) => { $('#monitorbox button[name=live]').toggleClass('active', live) });
    monitor.on('add', () => {
        if (vsplit.getSizes()[1] == 0) vsplit.setSizes([75, 25]);
    });
    const show_range = () => {
        $('#monitorbox input[name=rangel]').val(Math.round(monitorview.start));
        $('#monitorbox input[name=rangeh]').val(Math.round(monitorview.start + monitorview.width / monitorview.pixelsPerTick));
    };
    const show_scale = () => {
        $('#monitorbox input[name=scale]').val(monitorview.gridStep);
    };
    show_range();
    show_scale();
    monitorview.on('change:start', show_range);
    monitorview.on('change:pixelsPerTick', show_scale);
}

function runquery() {
    const data = {'_input.sv': editor.getValue()};
    for (const [filename, file] of Object.entries(filedata)) {
        data[filename] = file.result;
    }
    destroycircuit();
    $.ajax({
        type: 'POST',
        url: '/api/yosys2digitaljs',
        contentType: "application/json",
        data: JSON.stringify(data),
        dataType: 'json',
        success: (responseData, status, xhr) => {
            mkcircuit(responseData.output);
        },
        error: (request, status, error) => {
            loading = false;
            updatebuttons();
            $('form').find('input, textarea, button, select').prop('disabled', false);
            $('<div class="alert alert-danger alert-dismissible fade show" role="alert"></div>')
                .append('<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>')
                .append(document.createTextNode(request.responseJSON.error))
                .append($("<pre>").text(request.responseJSON.messages.stderr.trim()))
                .appendTo($('#editor'))
                .alert();
        }
    });
}

$('button[type=submit]').click(e => {
    e.preventDefault();
    $('form').find('input, textarea, button, select').prop('disabled', true);
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
});

$('button[name=pause]').click(e => {
    circuit.stop();
    updatebuttons();
});

$('button[name=resume]').click(e => {
    circuit.start();
    updatebuttons();
});

$('button[name=single]').click(e => {
    circuit.updateGates();
    updatebuttons();
});

$('button[name=next]').click(e => {
    while (!circuit.updateGates());
    updatebuttons();
});

$('button[name=load]').click(e => {
    $('#input_load').trigger('click');
});

$('#input_load').change(e => {
    const files = e.target.files;
    if (!files) return;
    const reader = new FileReader();
    destroycircuit();
    reader.onload = (e) => {
        mkcircuit(JSON.parse(e.target.result));
    };
    reader.readAsText(files[0]);
});

$('button[name=save]').click(e => {
    const json = circuit.toJSON();
    const blob = new Blob([JSON.stringify(json)], {type: "application/json;charset=utf-8"});
    saveAs(blob, 'circuit.json');
});

$('button[name=link]')
    .popover({
        container: 'body',
        content: 'blah',
        trigger: 'manual',
        html: true
    })
    .popover('disable')
    .click(e => {
        const json = circuit.toJSON();
        $.ajax({
            type: 'POST',
            url: '/api/storeCircuit',
            contentType: "application/json",
            data: JSON.stringify(json),
            dataType: 'json',
            success: (responseData, status, xhr) => {
                history.replaceState(null, null, '#'+responseData);
                $(e.target)
                    .attr('data-content', '<div class="btn-toolbar"><div class="input-group mr-2"><input readonly="readonly" id="linkinput" type="text" value="' + window.location.href + '"></div><div class="btn-group mr-2"><button type="button" data-clipboard-target="#linkinput" class="btn clipboard btn-secondary">Copy link</button></div></div>')
                    .popover('enable')
                    .popover('show');
            }
        });
    })
    .on("hidden.bs.popover", function() { $(this).popover('disable') });

$('html').click(e => {
    if (!$(e.target).closest('button[name=link]').length &&
        !$(e.target).closest('.popover').length)
        $('button[name=link]').popover('hide');
});

window.onpopstate = () => {
    const hash = window.location.hash.slice(1);
    if (loading || !hash) return;
    destroycircuit();
    $.ajax({
        type: 'GET',
        url: '/api/circuit/' + hash,
        dataType: 'json',
        success: (responseData, status, xhr) => {
            mkcircuit(responseData);
        },
        error: (request, status, error) => {
            loading = false;
            updatebuttons();
        }
    });
};

updatebuttons();
$('#monitorbox button').prop('disabled', true).off();

if (window.location.hash.slice(1))
    window.onpopstate();

new ClipboardJS('button.clipboard');

});


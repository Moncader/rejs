'use strict';
var fs = require('fs');
var argv = require('optimist').argv;
var rejs = require('../src/rejs');
var pkg = require(__dirname + '/../package.json');

var tResolver = new rejs.Resolver({});
var tOutFile = argv.o || argv.out;
var tFiles = argv._;
var tBlobs = {};
var tMessage = '';

// Print help message
if (argv.h || argv.help) {
  tMessage += 'Usage:\n';
  tMessage += '    rejs [options] [file ...]\n\n';
  tMessage += 'Examples:\n';
  tMessage += '    rejs foo.js bar.js baz.js\n';
  tMessage += '    rejs --out out.js foo.js bar.js baz.js\n\n';
  tMessage += 'Options:\n';
  tMessage += '  -h, --help     Print this message\n';
  tMessage += '  -o, --out      Output to single file\n'
  tMessage += '  -v, --version  Print rejs version';
  console.info(tMessage);
  return;
}

// Print rejs version
if (argv.v || argv.version) {
  tMessage += 'v';
  tMessage += pkg.version;
  console.info(tMessage);
  return;
}

if (tFiles.length === 0) {
  console.info('See: rejs -h');
  return;
}

tFiles.forEach(function (pFile) {
  tBlobs[pFile] = fs.readFileSync(pFile);
});

var tSortedFiles = tResolver.resolve(tBlobs);
var tBuffer;

// Output to stdout
if (!tOutFile) {
  tSortedFiles.forEach(function (pSortedFile) {
    tBuffer = fs.readFileSync(pSortedFile);
    process.stdout.write(tBuffer);
  });
  process.stdout.write('\n');
  return;
}

// Output to single file
var tOutputFD = fs.openSync(tOutFile, 'w');
tSortedFiles.forEach(function (pSortedFile) {
  tBuffer = fs.readFileSync(pSortedFile);
  fs.writeSync(tOutputFD, tBuffer, 0, tBuffer.length, null);
});

fs.closeSync(tOutputFD);

'use strict';
var fs = require('fs');
var argv = require('optimist').argv;
var rejs = require('../src/rejs');
var pkg = require(__dirname + '/../package.json');
var tResolver = new rejs.Resolver({
  readCache: function () { return null; },
  writeCache: function () {},
  log: function () {}
});
var outFile = argv.o || argv.out;
var tFiles = argv._;
var tBlobs = {};
var message = '';

// Print help message
if (argv.h || argv.help) {
  message += 'Usage:\n';
  message += '    rejs [options] [file ...]\n\n';
  message += 'Examples:\n';
  message += '    rejs foo.js bar.js baz.js\n';
  message += '    rejs --out out.js foo.js bar.js baz.js\n\n';
  message += 'Options:\n';
  message += '  -h, --help     Print this message\n';
  message += '  -o, --out      Output to single file\n'
  message += '  -v, --version  Print rejs version';
  console.info(message);
  return;
}

// Print rejs version
if (argv.v || argv.version) {
  message += 'v';
  message += pkg.version;
  console.info(message);
  return;
}

if (tFiles.length === 0) {
  console.info('See: rejs -h');
  return;
}

tFiles.forEach(function (tFile) {
  tBlobs[tFile] = fs.readFileSync(tFile);
});

var tSortedFiles = tResolver.resolve(tBlobs);
var tBuffer;
var stdout = '';

// Output to stdout
if (!outFile) {
  tSortedFiles.forEach(function (tSortedFile) {
    tBuffer = fs.readFileSync(tSortedFile);
    process.stdout.write(tBuffer);
  });
  process.stdout.write('\n');
  return;
}

// Output to single file
var tOutputFD = fs.openSync(outFile, 'w');
tSortedFiles.forEach(function (tSortedFile) {
  tBuffer = fs.readFileSync(tSortedFile);
  fs.writeSync(tOutputFD, tBuffer, 0, tBuffer.length, null);
});

fs.closeSync(tOutputFD);

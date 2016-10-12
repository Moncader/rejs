'use strict';

var pkg = require(__dirname + '/../package.json');
var yargs = require('yargs')
  .usage('rejs [options] [file ...]')
  .example('rejs foo.js bar.js baz.js', '')
  .example('rejs --out out.js foo.js bar.js baz.js', '')

  .alias('o', 'out')
  .describe('o', 'Output to single file')

  .alias('v', 'verbose')
  .describe('v', 'Log verbose information to stderr')
  .count('v')
  .boolean('v')

  .alias('n', 'names-only')
  .describe('n', 'Only output the ordered file names. Not the files themselves')
  .boolean('n')

  .alias('g', 'global-closure-references')
  .describe('g', 'Comma-separated list of names for the global closure variable. (Like window,global)')

  .demand(1, 'Need to specify one or more files');

yargs.help('help');
yargs.version(pkg.version + '\n', 'version');

var argv = yargs.argv;
var fs = require('fs');
var rejs = require('../src/rejs');

var tOutFile = argv.o || argv.out;
var tVerbosity = argv.v - 1;
var tGlobalClosureReferences = argv.g ? argv.g.split(',').map(function(pValue) {
  return pValue.trim();
}) : [];
var tFiles = argv._;
var tBlobs = {};
var tErrors = [];

function log(pVerbosity) {
  if (tVerbosity >= pVerbosity) {
    process.stderr.write(Array.prototype.slice.call(arguments, 1).join(' ') + '\n');
  }
}

function readSource(pKey) {
  var tBlob;

  try {
    tBlob = tBlobs[pKey] = fs.readFileSync(pKey, {
      encoding: 'utf-8'
    });
  } catch (e) {
    process.stderr.write(e);
    process.exit(1);
  }

  return tBlob;
}

var tResolver = new rejs.Resolver({
  readSource: readSource,
  verbosity: tVerbosity,
  log: log,
  globalClosureReferences: tGlobalClosureReferences
});

tFiles.forEach(function(pFile) {
  try {
    tResolver.add(pFile);
  } catch (e) {
    tErrors.push({
      key: pFile,
      error: e
    });
  }
});

if (tErrors.length > 0) {
  process.stderr.write('Errors occured. Aborting.\n');

  tErrors.forEach(function(pError) {
    process.stderr.write('\n' + pError.key + ':\n');
    process.stderr.write(pError.error + '\n');

    if (tVerbosity > 1 && pError.error.stack) {
      process.stderr.write(pError.error.stack + '\n');
    }
  });

  process.exit(1);

  return;
}

var tSortedFiles = tResolver.resolve();

if (argv.n) {
  process.stdout.write(tSortedFiles.join('\n'));
  process.stdout.write('\n');

  return;
}

// Output to stdout
if (!tOutFile) {
  tSortedFiles.forEach(function(pSortedFile) {
    process.stdout.write(tBlobs[pSortedFile] + '\n');
  });

  return;
}

// Output to single file
var tOutputFD = fs.openSync(tOutFile, 'w');

tSortedFiles.forEach(function(pSortedFile) {
  var tBlob = tBlobs[pSortedFile] + '\n';
  fs.writeSync(tOutputFD, tBlob);
});

fs.closeSync(tOutputFD);

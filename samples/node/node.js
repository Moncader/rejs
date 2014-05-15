var rejs = require('../../src/rejs');
var exec = require('child_process').exec;
var fs = require('fs');

function readCache(pKey) {
  //console.log('Read cache: ' + pKey);

  return null;
}

function writeCache(pKey, pData) {
  //console.log('Write cache: ' + pKey);
}

function log(pString) {
  //console.log(pString);
} 

var tOptions = {
  readCache: readCache,
  writeCache: writeCache,
  log: log
};

exec('find ./ -type f -name "*.js" -not -name "node.js"', function(pError, pStdout, pStderr) {
  var tResolver = new rejs.Resolver(tOptions);

  var tFiles = pStdout.split('\n');
  var tFile;
  var tBlobs = {};
  var i, il;

  for (i = 0, il = tFiles.length; i < il; i++) {
    tFile = tFiles[i];

    if (tFile) {
      tBlobs[tFiles[i]] = fs.readFileSync(tFiles[i]);
    }
  }

  var tSortedFiles = tResolver.resolve(tBlobs);
  var tOutputFD = fs.openSync('out.js', 'w');
  var tBuffer;

  for (i = 0, il = tSortedFiles.length; i < il; i++) {
    tBuffer = fs.readFileSync(tSortedFiles[i]);
    fs.writeSync(tOutputFD, tBuffer, 0, tBuffer.length, null);
  }

  fs.closeSync(tOutputFD);
});
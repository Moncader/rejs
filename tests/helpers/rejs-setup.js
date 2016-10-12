var fs = require('fs');

global.rejs = require('../../src/rejs');

global.defaultRejsOptions = {
  readSource: function(pKey) {
    return fs.readFileSync('tests/' + pKey, {
      encoding: 'utf-8'
    });
  },
  verbosity: 1,
  log: function(pVerbosity, pMessage) {
    console.log(pMessage);
  }
};

global.rejsResolve = function(pFiles, pOptions) {
  var tResolver = new rejs.Resolver(pOptions || global.defaultRejsOptions);

  tResolver.add(pFiles);

  return tResolver.resolve();
};

/**
 * @author Jason Parrott
 *
 * Copyright (C) 2014 ReJS Project.
 * This code is licensed under the zlib license. See LICENSE for details.
 */

(function(pAPI) {
  'use strict';

  pAPI.Resolver = Resolver;

  var mAcorn;

  if (typeof acorn !== 'undefined') {
    mAcorn = acorn;
  } else {
    mAcorn = require('acorn');
  }

  function defaultReadCache() {
    return null;
  }

  function defaultWriteCache() {
    return null;
  }

  function defaultLog() {

  }

  var mASTProperties = [
    'elements',
    'left',
    'right',
    'body',
    'callee',
    'arguments',
    'param',
    'test',
    'consequent',
    'alternate',
    'expression',
    'init',
    'update',
    'params',
    'defaults',
    'object',
    'property',
    'properties',
    'argument',
    'key',
    'value',
    'expressions',
    'discriminant',
    'cases',
    'block',
    'guardedHandlers',
    'handlers',
    'finalizer',
    'declarations'
  ];

  /**
   * A Resolver can resolve the dependency order of
   * JavaScript code based on a set of keys provided to it.
   * @param {object} pOptions Options for the Resolver.
   */
  function Resolver(pOptions) {
    if (typeof pOptions.readSource !== 'function') {
      throw new Error('readSource option not set');
    }

    this.readSource = pOptions.readSource;
    this.readCache = pOptions.readCache || defaultReadCache;
    this.writeCache = pOptions.writeCache || defaultWriteCache;
    this.globalObject = pOptions.globalObject || {};
    this.acornOptions = pOptions.acornOptions;
    this.log = pOptions.log || defaultLog;
    this.verbosity = pOptions.verbosity || 0;

    this.globalClosureReferences = pOptions.globalClosureReferences || [];

    this._stats = [];
    this._statsMap = {};
    this._exportMap = {};

    this._namespaceValueExportMap = {};
    this._namespaceValueRequireMap = {};
    this._phase2References = [];
    this._valueIdMap = {};

    this.currentKey = null;
  }

  function ResolverKeyError(pKey, pMessage, pOriginalError) {
    this.key = pKey;
    this.message = pMessage;
    this.originalError = pOriginalError;

    if (pOriginalError && pOriginalError.stack) {
      this.stack = pOriginalError.stack;
    }
  }

  ResolverKeyError.prototype = Object.create(Error.prototype);
  ResolverKeyError.prototype.constructor = ResolverKeyError;

  ResolverKeyError.prototype.toString = function() {
    return [
      'ResolverKeyError: ' + this.message,
      'Key: ' + this.key,
      'Original Error: ' + (this.originalError || 'None')
    ].join('\n');
  };

  var tProto = Resolver.prototype;

  /**
   * Finds the index for the key in the stats for the Resovler.
   * @private
   * @param  {Resolver} pResolver
   * @param  {string}   pKey
   * @return {number}             The Index
   */
  function findKeyStatsIndex(pResolver, pKey) {
    var tStats = pResolver._stats;

    for (var i = 0, il = tStats.length; i < il; i++) {
      if (tStats[i].key === pKey) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Adds a new key (or overrides a key of the same name)
   * to the Resolver.
   * @private
   * @param {Resolver} pResolver
   * @param {string} pKey
   */
  function addKey(pResolver, pKey) {
    var tReadFunction;
    var tSource;
    var tStatsIndex = findKeyStatsIndex(pResolver, pKey);
    var tStats;
    var tAST;
    var tVM;

    if (tStatsIndex !== -1) {
      pResolver._stats.splice(tStatsIndex, 1);
    }

    tReadFunction = pResolver.readCache;
    tStats = tReadFunction(pKey);

    if (tStats !== null) {
      pResolver._stats.push({
        key: pKey,
        data: tStats
      });

      return '';
    }

    tReadFunction = pResolver.readSource;
    tSource = tReadFunction(pKey);

    if (tSource === null || tSource === void 0) {
      return 'Non existing source';
    } else if (typeof tSource === 'string') {
      tAST = mAcorn.parse(tSource, pResolver.acornOptions);
    } else if (typeof tSource === 'object') {
      // This better be some AST
      tAST = tSource;
    } else {
      return 'Invalid source';
    }

    var tBackupKey = pResolver.currentKey;

    pResolver.currentKey = pKey;

    tVM = new VM(pResolver);
    tVM.name = pKey;

    // First AST Execution
    tVM.execute(tAST);

    // Now export requirements and exports
    tStats = exportStats(tVM.globalClosure, false, pKey);

    pResolver._stats.push({
      key: pKey,
      data: tStats,
      vm: tVM
    });

    pResolver._statsMap[pKey] = tStats;

    updateVM(pResolver, tStats, pKey);

    pResolver.currentKey = tBackupKey;

    return '';
  };

  /**
   * Add new keys (as an Array) or a new key (as a string)
   * to this Resolver.
   * @param {Array.<string>|string} pKeys
   */
  tProto.add = function(pKeys) {
    var tError;

    if (typeof pKeys === 'string') {
      pKeys = [pKeys];
    }

    for (var i = 0, il = pKeys.length; i < il; i++) {
      try {
        tError = addKey(this, pKeys[i]);
      } catch (e) {
        throw new ResolverKeyError(pKeys[i], e.message, e);
      }

      if (tError !== '') {
        throw new ResolverKeyError(pKeys[i], tError, null);
      }
    }
  };

  tProto.resolve = function(pExports) {
    return sortStats(this, pExports || null);
  };


  /////////////////////////////////////////////////////////
  /// VM Code
  /////////////////////////////////////////////////////////

  /////////////////////////////
  /// VM
  /////////////////////////////

  function createPrototypes(pVM) {
    var tObjectPrototype = pVM.objectPrototype = new Value(pVM, true, false, void 0, null, true, pVM.resolver.currentKey);
    tObjectPrototype.properties = {};

    var tFunctionPrototype = pVM.functionPrototype = new Value(pVM, true, false, void 0, tObjectPrototype, true, pVM.resolver.currentKey);

    tFunctionPrototype.setProperty(
      'call',
      pVM.reference(
        new NativeFunctionValue(
          pVM,
          function(pThisReference) {
            var tCallee = this.thisReference;

            if (tCallee === null || !(tCallee.value instanceof FunctionValue)) {
              return this.undefinedReference();
            }

            var tArguments = [];
            var tArgumentsValueProperties = this.getReference('arguments').value.properties;
            var i, il;
            var tKeys;

            if (tArgumentsValueProperties !== null) {
              tKeys = Object.keys(tArgumentsValueProperties);

              for (i = 1, il = tKeys.length; i < il; i++) {
                tArguments[i - 1] = tArgumentsValueProperties[tKeys[i]];
              }
            }

            return tCallee.value.instance(pThisReference, tArguments).execute();
          }
        ),
        false
      )
    );
  }

  function createRejsNamespace(pVM) {
    pVM.globalClosure.local('rejs', pVM.wrap({
      log: function(pReference) {
        if (!pReference) {
          this.log(1, void 0);

          return;
        }

        var tValue = pReference.value;

        this.log(1, tValue.literal !== void 0 ? tValue.literal : (tValue.properties !== null ? tValue.properties : void 0));
      },
      dump: function(pReference, pDeep) {
        if (!pReference) {
          this.log(2, void 0);

          return;
        }

        var tValue = pReference.value;

        if (pDeep && pDeep.value.literal === true) {
          this.log(2, tValue);
        } else {
          this.log(2, {
            id: tValue.id,
            literal: tValue.literal,
            properties: tValue.properties ? Object.keys(tValue.properties) : null,
            proto: tValue.proto ? tValue.proto.id : null,
            isSet: tValue.isSet,
            isRequired: tValue.isRequired,
            isNative: tValue.isNative
          });
        }
      },
      debugger: function() {
        debugger;
      }
    }));
  }

  function createGlobalClosureReferences(pVM, pGlobalValue, pReferences) {
    for (var i = 0, il = pReferences.length; i < il; i++) {
      pVM.globalClosure.local(pReferences[i], pVM.reference(pGlobalValue, false));
    }
  }

  function VM(pResolver) {
    this.name = '';
    this.resolver = pResolver;
    this.callDepth = 0;
    this.executedValueIds = {};
    this.phase2ValueIds = {};

    createPrototypes(this);

    var tGlobalObject = new Value(this, true, false, void 0, null, false, pResolver.currentKey);

    this.globalClosure = new Closure(this, this.reference(tGlobalObject, false), tGlobalObject, []);

    createRejsNamespace(this);

    if (pResolver.globalClosureReferences) {
      createGlobalClosureReferences(this, this.globalClosure.locals, pResolver.globalClosureReferences);
    }
  }

  tProto = VM.prototype;

  tProto.value = function(pPrototype) {
    return new Value(this, true, false, void 0, pPrototype || this.objectPrototype, false, this.resolver.currentKey);
  };

  tProto.reference = function(pValue, pIsSet) {
    return new Reference(pValue, pIsSet, this.resolver.currentKey);
  };

  tProto.valueReference = function(pPrototype) {
    return new Reference(this.value(pPrototype), false, this.resolver.currentKey);
  };

  tProto.literalReference = function(pLiteral) {
    return new Reference(new Value(this, true, false, pLiteral, this.objectPrototype, false, this.resolver.currentKey), false, this.resolver.currentKey);
  };

  tProto.undefinedReference = function() {
    return new Reference(new Value(this, true, false, void 0, this.objectPrototype, false, this.resolver.currentKey), false, this.resolver.currentKey);
  };

  tProto.requiredReference = function() {
    return new Reference(new Value(this, false, true, void 0, this.objectPrototype, false, this.resolver.currentKey), false, this.resolver.currentKey);
  };

  tProto.execute = function(pAST) {
    this.globalClosure.execute(pAST);
  };

  tProto.wrap = function(pData, pConvertFunctions) {
    var tVM = this;
    var tValues = [];
    var tObjects = [];

    function wrap(pData) {
      var tType;
      var tIndex;
      var tValue;
      var tKeys;
      var i, il;

      if (pData === void 0) {
        return tVM.undefinedReference();
      } else if (pData === null) {
        return tVM.literalReference(pData);
      } else if (pData instanceof Reference) {
        return pData;
      } else if (pData instanceof Value) {
        return new Reference(pData, false, tVM.resolver.currentKey);
      } else {
        tType = typeof pData;

        if (tType === 'object') {
          if ((tIndex = tObjects.indexOf(pData)) >= 0) {
            return new Reference(tValues[tIndex], false, tVM.resolver.currentKey);
          }

          // Convert this object to our own system manually.

          tValue = new Value(tVM, true, false, void 0, pData.__proto__ === null ? null : wrap(pData.__proto__), true, tVM.resolver.currentKey);
          tObjects.push(pData);
          tValues.push(tValue);

          tKeys = Object.keys(pData);

          for (i = 0, il = tKeys.length; i < il; i++) {
            tValue.setProperty(tKeys[i], wrap(pData[tKeys[i]]));
          }

          return new Reference(tValue, false, tVM.resolver.currentKey);
        } else if (tType === 'function') {
          if ((tIndex = tObjects.indexOf(pData)) >= 0) {
            return new Reference(tValues[tIndex], false, tVM.resolver.currentKey);
          }

          if (pConvertFunctions) {
            // TODO: Attempt to get the source code via toString
            // then ASTize it, and make a new FunctionValue.
            return tVM.undefinedReference();
          }

          tValue = new NativeFunctionValue(tVM, pData);
          tObjects.push(pData);
          tValues.push(tValue);

          return new Reference(tValue, false, tVM.resolver.currentKey);
        } else {
          return tVM.literalReference(pData);
        }
      }
    }

    return wrap(pData);
  };

  tProto.log = function(pVerbosity, pObject) {
    var mCache = [];

    this.resolver.log(pVerbosity, JSON.stringify(pObject, function(pKey, pValue) {
      if (pValue === void 0) {
        return '(undefined)';
      } else if (typeof pValue === 'object' && pValue !== null) {
        if (mCache.indexOf(pValue) !== -1) {
          return '... (circular reference to object)';
        }

        if (pValue instanceof VM || pValue instanceof Closure) {
          return;
        }

        mCache.push(pValue);
      } else if (typeof pValue === 'function') {
        if (mCache.indexOf(pValue) !== -1) {
          return '... (circular reference to function)';
        }

        if (pValue instanceof VM || pValue instanceof Closure) {
          return;
        }

        mCache.push(pValue);

        var tObject = {};

        for (var k in pValue) {
          tObject[k] = pValue[k];
        }

        return tObject;
      }

      return pValue;
    }, 2));
  };

  /////////////////////////////
  /// Values
  /////////////////////////////

  var mValueCounter = 0;

  function Value(pVM, pIsSet, pIsRequired, pLiteral, pProtoValue, pIsNative, pReasonKey) {
    this.id = ++mValueCounter + '';
    this.literal = pLiteral;
    this.properties = null;
    this.proto = pProtoValue;
    this.isSet = pIsSet;
    this.isRequired = pIsRequired;
    this.isNative = pIsNative;
    this.reasonKey = pReasonKey;
    this.vm = pVM;

    this._references = [];
    this._isMerging = false;
  }

  tProto = Value.prototype;

  tProto.remap = function(pOldValue) {
    var i, il, tKeys, tKey;
    var tProperties, tNewProperties;

    if (this._isMerging === true || this === pOldValue) {
      return;
    }

    this._isMerging = true;

    var tOldReferences = pOldValue._references;
    var tReferences = this._references;
    var tReference;

    for (i = 0, il = tOldReferences.length; i < il; i++) {
      tReference = tOldReferences[i];
      tReference.value = this;
      tReferences.push(tReference);
    }

    tOldReferences.length = 0;

    this.literal = pOldValue.literal;

    //this.isRequired = !!(this.isRequired & pOldValue.isRequired);
    //this.isSet = !!(this.isSet | pOldValue.isSet);

    if (this.proto !== pOldValue.proto) {
      if (this.proto === null) {
        this.proto = pOldValue.proto;
      } else if (pOldValue.proto !== null) {
        this.proto.remap(pOldValue.proto);
      }
    }

    tProperties = this.properties;
    tNewProperties = pOldValue.properties;

    if (tProperties !== null && tNewProperties !== null) {
      tKeys = Object.keys(tNewProperties);

      for (i = 0, il = tKeys.length; i < il; i++) {
        tKey = tKeys[i];

        if (tProperties.hasOwnProperty(tKey) === true) {
          if (tProperties[tKey].value.isRequired === true && tNewProperties[tKey].value.isRequired === false) {
            // Merging something that was complete with something that isn't.
            // Use the complete one.
            tNewProperties[tKey].value.remap(tProperties[tKey].value);
          } else {
            // For any other state, just do a regular remap.
            // Don't care if both were isRequired false...
            tProperties[tKey].value.remap(tNewProperties[tKey].value);
          }
        } else {
          tProperties[tKey] = tNewProperties[tKey];
        }
      }
    } else if (tNewProperties !== null) {
      this.properties = tNewProperties;
    }

    this._isMerging = false;
  };

  tProto.setLiteral = function(pValue) {
    this.literal = pValue;
    this.isSet = true;
  };

  tProto.require = function() {
    this.isRequired = true;
  };

  tProto.setProperty = function(pName, pReference) {
    var tProperties = this.properties || (this.properties = {});

    tProperties[pName] = pReference;
  };

  tProto.getProperty = function(pName) {
    var tProperties = this.properties;
    var tProto;

    if (tProperties !== null && tProperties.hasOwnProperty(pName) === true) {
      return tProperties[pName];
    }

    for (tProto = this.proto; tProto !== null; tProto = tProto.proto) {
      tProperties = tProto.properties;

      if (tProperties !== null && tProperties.hasOwnProperty(pName) === true) {
        return tProperties[pName];
      }

      if (tProto.proto === tProto) {
        break;
      }
    }

    return null;
  };

  tProto.asPrimitive = function() {
    if (this.literal !== void 0) {
      return this.literal;
    } else if (this.properties !== null) {
      // TODO: The spec says to call the DefaultValue of the object.
      // Usually that's Number... sort of... so we'll return NaN
      return NaN;
    } else {
      return void 0;
    }
  };

  tProto.asString = function() {
    var tLiteral = this.literal;

    if (typeof tLiteral === 'string') {
      return tLiteral;
    } else if (this.properties !== null) {
      return '[object Object]';
    } else {
      return tLiteral + '';
    }
  };

  tProto.asNumber = function() {
    var tLiteral = this.literal;
    var tType = typeof tLiteral;

    if (tType === 'number') {
      return tLiteral;
    } else if (this.properties !== null) {
      return NaN;
    } else {
      return +tLiteral;
    }
  };

  tProto.asBoolean = function() {
    var tLiteral = this.literal;

    if (tLiteral === void 0) {
      if (this.properties !== null) {
        return true;
      }

      return false;
    }

    return !!tLiteral;
  };

  /////////////////////////////
  /// Function Value
  /////////////////////////////

  function FunctionValue(pVM, pParentClosures, pName, pArguments, pAST) {
    Value.call(this, pVM, true, false, void 0, pVM.functionPrototype, false);

    this.parentClosures = pParentClosures;
    this.name = pName;
    this.args = pArguments;
    this.ast = pAST;

    this.setProperty('prototype', pVM.valueReference(pVM.objectPrototype));
  }

  tProto = FunctionValue.prototype = Object.create(Value.prototype);
  tProto.constructor = FunctionValue;

  tProto.instance = function(pThisReference, pArguments) {
    var tInstance = new Closure(this.vm, pThisReference ? new Reference(pThisReference.value, false, this.vm.resolver.currentKey) : void 0, this.vm.value(), this.parentClosures, this);
    var tArgumentsReference = tInstance.valueReference();
    var tArgumentsValue = tArgumentsReference.value;
    var tArgumentNames;
    var i, il;

    tInstance.ast = this.ast;

    if (this.name) {
      tInstance.local(this.name, new Reference(this, false, this.vm.resolver.currentKey));
    }

    for (i = 0, il = pArguments.length; i < il; i++) {
      tArgumentsValue.setProperty(i + '', pArguments[i] ? tInstance.reference(pArguments[i].value) : pArguments[i]);
    }

    tInstance.local('arguments', tArgumentsReference);

    tArgumentNames = this.args;

    if (tArgumentNames) {
      for (i = 0, il = tArgumentNames.length; i < il; i++) {
        tInstance.local(tArgumentNames[i], pArguments[i] ? tInstance.reference(pArguments[i].value) : this.vm.undefinedReference());
      }
    }

    return tInstance;
  };

  /////////////////////////////
  /// NativeFunction Value
  /////////////////////////////

  function NativeFunctionValue(pVM, pCallback) {
    FunctionValue.call(this, pVM, [], void 0, [], [
      {
        type: 'rejsNativeCallback',
        callback: pCallback
      }
    ]);
  }

  tProto = NativeFunctionValue.prototype = Object.create(FunctionValue.prototype);
  tProto.constructor = NativeFunctionValue;

  /////////////////////////////
  /// References
  /////////////////////////////

  function Reference(pValue, pIsSet, pReasonKey) {
    this.value = pValue;
    this.isSet = !!pIsSet;
    this.binding = null;
    this.phase2 = null;
    this.reasonKey = pReasonKey;

    pValue._references.push(this);
  }

  tProto = Reference.prototype;

  tProto.registerPhase2 = function(pClosure, pIsNew, pArguments) {
    var tPhase2 = this.phase2 || (this.phase2 = []);

    tPhase2.push({
      closure: pClosure,
      isNew: pIsNew,
      arguments: pArguments
    });
  };

  /////////////////////////////
  /// Closures
  /////////////////////////////

  function Closure(pVM, pThisReference, pLocals, pParentClosures, pFunctionValue) {
    this.vm = pVM;
    this.thisReference = pThisReference || new Reference(pVM.globalClosure.locals, false, pVM.resolver.currentKey);
    this.returnReference = this.undefinedReference();
    this.locals = pLocals;
    this.parentClosures = pParentClosures;
    this.ast = null;
    this.functionValue = pFunctionValue || null;
  }

  tProto = Closure.prototype;

  tProto.functionReference = function(pName, pArguments, pAST) {
    var tParentClosures = this.parentClosures.slice(0);
    tParentClosures.push(this);

    return new Reference(new FunctionValue(this.vm, tParentClosures, pName, pArguments, pAST), false, this.vm.resolver.currentKey);
  };

  tProto.valueReference = function(pPrototype) {
    return this.vm.valueReference(pPrototype);
  };

  tProto.literalReference = function(pLiteral) {
    return this.vm.literalReference(pLiteral);
  };

  tProto.reference = function(pValue) {
    return new Reference(pValue, false, this.vm.resolver.currentKey);
  };

  tProto.local = function(pName, pReference) {
    this.locals.setProperty(pName, pReference);
  };

  tProto.undefinedReference = function() {
    return this.vm.undefinedReference();
  };

  tProto.requiredReference = function() {
    return this.vm.requiredReference();
  };

  tProto.getReference = function(pName) {
    var tParentClosures = this.parentClosures;
    var tClosure;
    var i;
    var tReference = this.locals.getProperty(pName);

    if (tReference !== null) {
      return tReference;
    }

    for (i = tParentClosures.length - 1; i >= 0; i--) {
      tClosure = tParentClosures[i];
      tReference = tClosure.locals.getProperty(pName);

      if (tReference !== null) {
        return tReference;
      }
    }

    return null;
  };

  tProto.executeFunction = function(pFunctionValue, pIsNew, pArguments, pBinding) {
    var tThisReference;
    var tCalleeInstance;

    if (pIsNew === true) {
      tThisReference = this.valueReference(pFunctionValue.getProperty('prototype').value);
      tThisReference.value.properties = {};

      tCalleeInstance = pFunctionValue.instance(tThisReference, pArguments);
      tCalleeInstance.execute();

      return tThisReference;
    }

    if (pBinding !== null) {
      tThisReference = pBinding;
    }

    tCalleeInstance = pFunctionValue.instance(tThisReference, pArguments);
    tCalleeInstance.execute();

    return tCalleeInstance.returnReference;
  };

  tProto.wrap = function(pData) {
    return this.vm.wrap(pData);
  };

  tProto.log = function(pVerbosity, pMessage) {
    this.vm.log(pVerbosity, pMessage);
  };

  function preprocessAST(pClosure, pAST) {
    var tASTList;
    var tAST;
    var tType;
    var i, il, j, jl;
    var tKeys;
    var tKey;
    var tValue;
    var tArguments;
    var tReference;

    pClosure.vm.callDepth++;

    if (pAST.__proto__ !== Array.prototype) {
      tASTList = [pAST];
    } else {
      tASTList = pAST;
    }

    for (i = 0, il = tASTList.length; i < il; i++) {
      tAST = tASTList[i];
      tType = tAST.type;

      if (tType === 'VariableDeclarator') {
        tReference = pClosure.undefinedReference();
        tReference.isSet = true;

        pClosure.local(tAST.id.name, tReference);
      } else if (tType === 'FunctionDeclaration') {
        tArguments = [];
        tKeys = tAST.params;

        for (j = 0, jl = tKeys.length; j < jl; j++) {
          tArguments.push(tKeys[j].name);
        }

        tReference = pClosure.functionReference(tAST.id.name, tArguments, tAST.body);
        tReference.isSet = true;

        pClosure.local(tAST.id.name, tReference);
      } else if (tType === 'FunctionExpression') {
        // Ignore things that make their own Closure.
      } else {
        // Attempt to process everything else.
        tKeys = Object.keys(tAST);

        for (j = 0, jl = tKeys.length; j < jl; j++) {
          tKey = tKeys[j];

          if (tKey === 'start' || tKey === 'end' || tKey === 'type') {
            continue;
          }

          tValue = tAST[tKey];

          if (typeof tValue === 'object' && tValue !== null) {
            preprocessAST(pClosure, tValue);
          }
        }
      }
    }

    pClosure.vm.callDepth--;
  }

  function interpret(pClosure, pAST) {
    var tASTList;
    var tAST;
    var i, il;
    var tVM = pClosure.vm;
    var tType;
    var tResult = void 0;

    if (pAST.__proto__ !== Array.prototype) {
      tASTList = [pAST];
    } else {
      tASTList = pAST;
    }

    for (i = 0, il = tASTList.length; i < il; i++) {
      tAST = tASTList[i];
      tType = tAST.type;

      if (tType === 'FunctionDeclaration' || tType === 'VariableDeclarator') {
        continue;
      }

      if (tType in pClosure) {
        tResult = pClosure[tType](tAST);
      } else {
        // Default handler
        tResult = pClosure.undefinedReference();

        var tASTProperties = mASTProperties;
        var tASTPropertiesLength = tASTProperties.length;

        for (var j = 0; j < tASTPropertiesLength; j++) {
          if (tAST[tASTProperties[j]]) {
            tResult = interpret(pClosure, tAST[tASTProperties[j]]);
          }
        }
      }
    }

    return tResult;
  }

  tProto.execute = function(pAST) {
    if (this.functionValue !== null) {
      if (this.functionValue.id in this.vm.executedValueIds) {
        // Don't allow an already executed function
        // to be executed again. We'll get an infinite loop.
        //return this.vm.executedValueIds[this.functionValue.id];
      }
    }

    pAST = pAST || this.ast || [];

    preprocessAST(this, pAST);

    var tResult = interpret(this, pAST);

    if (this.functionValue !== null) {
      this.vm.executedValueIds[this.functionValue.id] = tResult;
    }

    return tResult;
  };


  /////////////////////////////
  /// AST Handlers
  /////////////////////////////

  tProto.rejsNativeCallback = function(pAST) {
    var tArguments = [];
    var tArgumentsValueProperties = this.getReference('arguments').value.properties;
    var i, il;
    var tKeys;

    if (tArgumentsValueProperties !== null) {
      tKeys = Object.keys(tArgumentsValueProperties);

      for (i = 0, il = tKeys.length; i < il; i++) {
        tArguments[i] = tArgumentsValueProperties[tKeys[i]];
      }
    }

    return (this.returnReference = this.wrap(pAST.callback.apply(this, tArguments)));
  };

  tProto.Program = tProto.BlockStatement = function(pAST) {
    return interpret(this, pAST.body);
  };

  tProto.ExpressionStatement = function(pAST) {
    return interpret(this, pAST.expression);
  };

  tProto.SequenceExpression = function(pAST) {
    var tExpressions = pAST.expressions;
    var i, il;
    var tResult;

    for (i = 0, il = tExpressions.length; i < il; i++) {
      tResult = interpret(this, tExpressions[i]);
    }

    return tResult;
  };

  tProto.EmptyExpression = tProto.EmptyStatement = function(pAST) {
    return this.literalReference(0);
  };

  tProto.NewExpression = tProto.CallExpression = function(pAST) {
    var tArgumentsAST = pAST.arguments;
    var tArguments = [];
    var tArgument;
    var tCalleeReference, tCalleeValue;
    var i, il;

    for (i = 0, il = tArgumentsAST.length; i < il; i++) {
      tArguments[i] = interpret(this, tArgumentsAST[i]);
    }

    tCalleeReference = interpret(this, pAST.callee);
    tCalleeValue = tCalleeReference.value;

    if (!(tCalleeValue instanceof FunctionValue)) {
      if (tCalleeValue.isSet === false) {
        // Register this function as something we
        // need to execute again once it has been resolved
        // in to the VM. It's possible there are side effects
        // on objects we pass in to this function as arguments.
        // It's also possible to there are side effects on the
        // file this function came from as well.
        tCalleeReference.registerPhase2(this, pAST.type === 'NewExpression', tArguments);
      }

      // Can't call this...
      // Since we aren't a full VM we should assume
      // that our VM messed up somewhere
      // and just ignore this.
      return this.undefinedReference();
    }

    return this.executeFunction(tCalleeValue, pAST.type === 'NewExpression', tArguments, tCalleeReference.binding);
  };

  tProto.FunctionExpression = function(pAST) {
    var tArguments = [];
    var tKeys = pAST.params;
    var i, il;

    for (i = 0, il = tKeys.length; i < il; i++) {
      tArguments.push(tKeys[i].name);
    }

    return this.functionReference(pAST.id ? pAST.id.name : void 0, tArguments, pAST.body);
  };

  tProto.TryStatement = function(pAST) {
    var tResult = this.undefinedReference();

    if (pAST.block) {
      tResult = interpret(this, pAST.block);
    }

    if (pAST.handler) {
      interpret(this, pAST.handler);
    }

    if (pAST.finalizer) {
      interpret(this, pAST.finalizer);
    }

    return tResult;
  };

  tProto.CatchClause = function(pAST) {
    var tResult = this.undefinedReference();

    if (pAST.pattern) {
      // How does this work?
      interpret(this, pAST.pattern);
    }

    if (pAST.body) {
      tResult = interpret(this, pAST.body);
    }

    return tResult;
  };

  tProto.VariableDeclaration = function(pAST) {
    var tDeclarations = pAST.declarations;
    var tDeclaration;
    var tReference;
    var i, il;

    for (i = 0, il = tDeclarations.length; i < il; i++) {
      tDeclaration = tDeclarations[i];

      if (tDeclaration.init) {
        tReference = this.reference(interpret(this, tDeclaration.init).value);
      } else {
        tReference = this.undefinedReference();
      }

      tReference.isSet = true;
      this.local(tDeclaration.id.name, tReference);
    }

    return tReference;
  };

  tProto.AssignmentExpression = function(pAST) {
    var tRightReference = interpret(this, pAST.right);
    var tLeftReference = interpret(this, pAST.left);
    var tOperator = pAST.operator;

    switch (tOperator) {
      case '=':
        tLeftReference.value = tRightReference.value;
        tLeftReference.isSet = true;
        tLeftReference.reasonKey = this.vm.resolver.currentKey;

        break;
      case '*=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() * tRightReference.value.asNumber();

        break;
      case '/=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() / tRightReference.value.asNumber();

        break;
      case '%=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() % tRightReference.value.asNumber();

        break;
      case '+=':
        tLeftReference.value.literal = tLeftReference.value.asPrimitive() + tRightReference.value.asPrimitive();

        break;
      case '-=':
        tLeftReference.value.literal = tLeftReference.value.asPrimitive() - tRightReference.value.asPrimitive();

        break;
      case '<<=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() << tRightReference.value.asNumber();

        break;
      case '>>=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() >> tRightReference.value.asNumber();

        break;
      case '>>>=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() >>> tRightReference.value.asNumber();

        break;
      case '&=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() & tRightReference.value.asNumber();

        break;
      case '^=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() ^ tRightReference.value.asNumber();

        break;
      case '|=':
        tLeftReference.value.literal = tLeftReference.value.asNumber() | tRightReference.value.asNumber();

        break;
      default:
        this.log(2, 'Unsupported AssignmentExpression Operator: ' + tOperator);

        break;
    }

    return tLeftReference;
  };

  tProto.BinaryExpression = tProto.LogicalExpression = function(pAST) {
    var tLeftValue = interpret(this, pAST.left).value;
    var tRightValue = interpret(this, pAST.right).value;
    var tOperator = pAST.operator;
    var tResult;

    switch (tOperator) {
      case '+':
        tResult = tLeftValue.asPrimitive() + tRightValue.asPrimitive();

        break;
      case '-':
        tResult = tLeftValue.asPrimitive() - tRightValue.asPrimitive();

        break;
      case '*':
        tResult = tLeftValue.asNumber() * tRightValue.asNumber();

        break;
      case '/':
        tResult = tLeftValue.asNumber() / tRightValue.asNumber();

        break;
      case '%':
        tResult = tLeftValue.asNumber() % tRightValue.asNumber();

        break;
      case '<<':
        tResult = tLeftValue.asNumber() << tRightValue.asNumber();

        break;
      case '>>':
        tResult = tLeftValue.asNumber() >> tRightValue.asNumber();

        break;
      case '>>>':
        tResult = tLeftValue.asNumber() >>> tRightValue.asNumber();

        break;
      case '&&':
        return this.reference(tLeftValue.asBoolean() ? tRightValue : tLeftValue);
      case '||':
        return this.reference(tLeftValue.asBoolean() ? tLeftValue : tRightValue);
      case '<':
      case '>':
      case '<=':
      case '>=':
      case '==':
      case '===':
      case '!=':
      case '!==':
      case 'instanceof':
      case 'in':
        // The result of all of this is a boolean that
        // in only very very rare cases would affect
        // the names of variables set.
        // Remember that we interpret all conditions in code
        // so it doesn't matter if a test passes or not.
        // Therefore for performance we'll just return false
        // for all of them.
        tResult = false;

        break;
      case '&':
        tResult = tLeftValue.asNumber() & tRightValue.asNumber();

        break;
      case '^':
        tResult = tLeftValue.asNumber() ^ tRightValue.asNumber();

        break;
      case '|':
        tResult = tLeftValue.asNumber() | tRightValue.asNumber();

        break;
      default:
        this.log(2, 'Unsupported BinaryExpression Operator: ' + tOperator);

        break;
    }


    return this.literalReference(tResult);
  };

  tProto.UnaryExpression = function(pAST) {
    var tValue = interpret(this, pAST.argument).value;
    var tOperator = pAST.operator;

    if (!pAST.prefix) {
      this.log(0, pAST);
    }

    switch (tOperator) {
      case 'delete':
        // Don't actually delete anything.
        return this.literalReference(true);
      case 'void':
        return this.undefinedReference();
      case 'typeof':
        if (tValue.literal !== void 0) {
          return this.literalReference(typeof tValue.literal);
        } else if (tValue.properties !== null) {
          return this.literalReference('object');
        } else {
          return this.literalReference('undefined');
        }
      case '+':
        return this.literalReference(tValue.asNumber());
      case '-':
        return this.literalReference(-tValue.asNumber());
      case '~':
        return this.literalReference(~tValue.asNumber());
      case '!':
        return this.literalReference(!tValue.asBoolean());
      default:
        this.log(2, 'Unsupported UnaryExpression Operator: ' + tOperator);

        break;
    }

    return this.undefinedReference();
  };

  tProto.UpdateExpression = function(pAST) {
    var tReference = interpret(this, pAST.argument);
    var tValue = tReference.value;
    var tOperator = pAST.operator;
    var tResult;

    if (tOperator === '++') {
      tResult = pAST.prefix ? ++tValue.literal : tValue.literal++;
    } else if (tOperator === '--') {
      tResult = pAST.prefix ? --tValue.literal : tValue.literal--;
    } else {
      this.log(2, 'Unsupported UpdateExpression Operator: ' + tOperator);
      tResult = tValue.asNumber();
    }

    return this.literalReference(tResult);
  };

  tProto.MemberExpression = function(pAST) {
    var tObjectReference = interpret(this, pAST.object);
    var tPropertyReference;
    var tName;
    var tReference;

    if (pAST.computed) {
      tPropertyReference = interpret(this, pAST.property);

      if (!tPropertyReference.value.isSet) {
        this.log(1, 'Used an unresolved computed property in a MemberExpression. Possible resolution failure ahead!');

        return this.undefinedReference();
      }

      tName = tPropertyReference.value.asString();
    } else {
      if (pAST.property.type === 'Identifier') {
        tName = pAST.property.name;
      } else {
        tPropertyReference = interpret(this, pAST.property);

        if (!tPropertyReference.value.isSet) {
          this.log(1, 'Used an unresolved computed property in a MemberExpression. Possible resolution failure ahead!');

          return this.undefinedReference();
        }

        tName = tPropertyReference.value.asString();
      }
    }

    tReference = tObjectReference.value.getProperty(tName);

    if (tReference === null) {
      tReference = this.requiredReference();
      tObjectReference.value.setProperty(tName, tReference);
    }

    tReference.binding = tObjectReference;

    return tReference;
  };

  tProto.Identifier = function(pAST) {
    var tName = pAST.name;
    var tReference = this.getReference(tName);

    if (tReference === null) {
      tReference = this.requiredReference();
      this.vm.globalClosure.local(tName, tReference);
    }

    return tReference;
  };

  tProto.ThisExpression = function(pAST) {
    return this.thisReference;
  };

  tProto.Literal = function(pAST) {
    return this.literalReference(pAST.value);
  };

  tProto.ObjectExpression = function(pAST) {
    var tObjectValue = new Value(this.vm, true, false, void 0, this.vm.objectPrototype, false, this.vm.resolver.currentKey);
    var tProperties = pAST.properties;
    var i, il;

    tObjectValue.properties = {};

    for (i = 0, il = tProperties.length; i < il; i++) {
      tObjectValue.setProperty(tProperties[i].key.name, interpret(this, tProperties[i].value));
    }

    return this.reference(tObjectValue);
  };

  tProto.ArrayExpression = function(pAST) {
    var tArrayValue = new Value(this.vm, true, false, void 0, this.vm.objectPrototype, false, this.vm.resolver.currentKey);
    var tElements = pAST.elements;
    var i, il;

    tArrayValue.properties = {};

    for (i = 0, il = tElements.length; i < il; i++) {
      tArrayValue.setProperty(i, interpret(this, tElements[i]));
    }

    return this.reference(tArrayValue);
  };

  tProto.IfStatement = tProto.ConditionalExpression = function(pAST) {
    var tTestResult = interpret(this, pAST.test);
    var tConsequent = interpret(this, pAST.consequent);

    // TODO: Allow option for actually paying attention
    // to the test results.

    if (pAST.alternate) {
      return interpret(this, pAST.alternate);
    }

    return tConsequent;
  };

  tProto.SwitchCase = function(pAST) {
    var tTestResult = interpret(this, pAST.test);
    var tConsequents = pAST.consequent;
    var tResult = this.undefinedReference();
    var i, il;

    for (i = 0, il = tConsequents.length; i < il; i++) {
      tResult = interpret(this, tConsequents[i]);
    }

    return tResult;
  };

  tProto.SwitchStatement = function(pAST) {
    var tDiscriminant = interpret(this, pAST.discriminant);
    var tCases = pAST.cases;
    var tResult = this.undefinedReference();
    var i, il;

    for (i = 0, il = tCases.length; i < il; i++) {
      tResult = interpret(this, tCases[i]);
    }

    return tResult;
  };

  tProto.ForInStatement = function(pAST) {
    var tLeft = interpret(this, pAST.left);
    var tRight = interpret(this, pAST.right);

    // TODO: Provide option to actually run this loop.

    var tResult = interpret(this, pAST.body);

    if (!tRight.isSet) {
      return this.requiredReference();
    }

    return tResult;
  };

  tProto.ForStatement = function(pAST) {
    var tInit = null;
    var tTest = null;
    var tUpdate = null;

    if (pAST.init) {
      tInit = interpret(this, pAST.init);
    }

    if (pAST.test) {
      tTest = interpret(this, pAST.test);
    }

    if (pAST.update) {
      tUpdate = interpret(this, pAST.update);
    }

    // TODO: Provide option to actually run this loop.

    var tResult = interpret(this, pAST.body);

    return tResult;
  };

  tProto.WhileStatement = function(pAST) {
    var tTest;
    var tResult = this.undefinedReference();

    if (pAST.test) {
      tTest = interpret(this, pAST.test);
    }

    if (pAST.body) {
      tResult = interpret(this, pAST.body);
    }

    return tResult;
  };

  tProto.DoWhileStatement = function(pAST) {
    var tTest;
    var tResult = this.undefinedReference();

    if (pAST.body) {
      tResult = interpret(this, pAST.body);
    }

    if (pAST.test) {
      tTest = interpret(this, pAST.test);
    }

    return tResult;
  };

  tProto.BreakStatement = tProto.ContinueStatement = function(pAST) {
    // Don't really care about breaks and continues...
    return this.undefinedReference();
  };

  tProto.LabeledStatement = function(pAST) {
    var tResult = interpret(this, pAST.body);

    return tResult;
  };

  tProto.ReturnStatement = function(pAST) {
    var tReturnReference;

    if (pAST.argument === null) {
      tReturnReference = this.undefinedReference();
    } else {
      tReturnReference = interpret(this, pAST.argument);
    }

    this.returnReference = tReturnReference;

    return tReturnReference;
  };

  function exportStats(pClosure, pOnlyNewValues, pReasonKey) {
    var tCache = {};
    var tNamespaceExportMap = pClosure.vm.resolver._namespaceValueExportMap;
    var tNamespaceRequireMap = pClosure.vm.resolver._namespaceValueRequireMap;
    var tNamespaceStack = [];
    var tRequires = [];
    var tExports = [];
    var tExportValues = {};
    var tRequiredValues = {};
    var tPhase2References = [];
    var tRootValue = true;

    function exportValue(pReference) {
      var tValue = pReference.value;
      var tValueId = tValue.id;
      var tNamespace;
      var tKeys, tKey;
      var tProperties;
      var i, il;

      if (tRootValue === false) {
        if (pReference.isSet === true && tValue.isNative === false) {
          tNamespace = tNamespaceStack.join('.');

          if (tValue.isRequired === true && pReasonKey === pReference.reasonKey) {
            tRequiredValues[tNamespace] = new Reference(tValue, false, null);
          }

          if (pReference.phase2 !== null && pReasonKey === pReference.reasonKey) {
            // Need to pass this value on to
            // phase 2.
            tPhase2References.push(pReference);
          }

          if (pOnlyNewValues === false) {
            tExports.push(tNamespace);
            tExportValues[tNamespace] = tValue;
          } else {
            if (pReasonKey === pReference.reasonKey && tNamespaceExportMap.hasOwnProperty(tNamespace) === false) {
              tExports.push(tNamespace);
              tExportValues[tNamespace] = tValue;
            }
          }

          if (tValueId in tCache) {
            return;
          }
        } else if (tValue.isRequired === true && tValue.isNative === false && !(tValue.id in tCache)) {
          tNamespace = tNamespaceStack.join('.');

          if (pOnlyNewValues === false || tNamespaceRequireMap.hasOwnProperty(tNamespace) === false) {
            if (pReasonKey === pReference.reasonKey) {
              tRequires.push(tNamespace);
              tRequiredValues[tNamespace] = new Reference(tValue, false, null);
            }

            if (pReference.phase2 !== null && pReasonKey === pReference.reasonKey) {
              // Need to pass this value on to
              // phase 2.
              tPhase2References.push(pReference);
            }
          }
        } else if (tValueId in tCache) {
          return;
        }
      } else {
        tRootValue = false;
      }

      tCache[tValueId] = tValue;

      tProperties = tValue.properties;

      if (tProperties === null) {
        return;
      }

      tKeys = Object.keys(tProperties);

      for (i = 0, il = tKeys.length; i < il; i++) {
        tKey = tKeys[i];

        if (tKey[0] === '_') {
          // rejs ignores these.
          continue;
        }

        tNamespaceStack.push(tKey);

        exportValue(tProperties[tKey]);

        tNamespaceStack.pop();
      }
    }

    exportValue(new Reference(pClosure.locals, false, pReasonKey));

    return {
      requires: tRequires,
      exports: tExports,
      //requiredReferences: tRequiredReferences,
      requiredValues: tRequiredValues,
      exportedValues: tExportValues,
      phase2References: tPhase2References
    };
  }

  function updateVM(pResolver, pStats, pKey) {
    var tNamespaceRequireMap = pResolver._namespaceValueRequireMap;
    var tNamespaceExportMap = pResolver._namespaceValueExportMap;
    var tPhase2References = pResolver._phase2References;
    var tValueIdMap = pResolver._valueIdMap;
    var tSideEffects = false;
    var tPhase2Data;
    var tKeys, tKey;
    var tReferences, tReference, tValue;
    var i, il, j, jl;

    phase2loop: for (i = 0, il = pStats.phase2References.length; i < il; i++) {
      for (j = 0, jl = tPhase2References.length; j < jl; j++) {
        if (tPhase2References[j] === pStats.phase2References[i]) {
          continue phase2loop;
        }
      }

      tPhase2References.push(pStats.phase2References[i]);
    }

    tKeys = Object.keys(pStats.requiredValues);

    for (i = 0, il = tKeys.length; i < il; i++) {
      tKey = tKeys[i];
      tValue = pStats.requiredValues[tKey].value;

      pResolver.log(3, pKey, 'NEW REQUIRE: ', tKey, tValue.id);

      if (tNamespaceRequireMap.hasOwnProperty(tKey) === true) {
        pResolver.log(3, 'had that...');

        if (tValue.isRequired === false) {
          // This was remapped inline and is now solved.
          pResolver.log(3, 'Remapping', tNamespaceRequireMap[tKey].id, tValue.id);

          tValue.remap(tNamespaceRequireMap[tKey]);
          tNamespaceRequireMap[tKey] = tValue;
        } else {
          pResolver.log(3, 'Remapping', tValue.id, tNamespaceRequireMap[tKey].id);

          tNamespaceRequireMap[tKey].remap(tValue);
        }
      } else if (tNamespaceExportMap.hasOwnProperty(tKey) === true) {
        pResolver.log(3, 'already solved that...');
        pResolver.log(3, 'Remapping', tValue.id, tNamespaceExportMap[tKey].id);

        tNamespaceExportMap[tKey].remap(tValue);
        tNamespaceRequireMap[tKey] = tNamespaceExportMap[tKey];
      } else {
        tNamespaceRequireMap[tKey] = tValue;
      }
    }

    // Build the map for VM values to global namespaces.
    tKeys = Object.keys(pStats.exportedValues);

    for (i = 0, il = tKeys.length; i < il; i++) {
      tKey = tKeys[i];
      tValue = tNamespaceExportMap[tKey] = pStats.exportedValues[tKey];

      // Next, for anybody in the require map waiting for this
      // key, update their values.
      if (tValue.isRequired === false) {
        pResolver.log(3, pKey, 'Defined ', tKey, tValue.id);

        if (tNamespaceRequireMap.hasOwnProperty(tKey) === true) {
          pResolver.log(3, pKey, 'Updating...');
          pResolver.log(3, 'Remapping', tNamespaceRequireMap[tKey].id, tValue.id);

          tValue.remap(tNamespaceRequireMap[tKey]);
          tNamespaceRequireMap[tKey] = tValue;
        }
      }
    }

    // Next, try to re-resolve the system if
    // there is anything that needs resolving.
    for (i = 0, il = tPhase2References.length; i < il; i++) {
      tReference = tPhase2References[i];
      tValue = tReference.value;

      if (tReference.phase2 === null) {
        // We processed this already. Ignore
        tPhase2References.splice(i, 1);
        i--;
        il--;

        continue;
      }

      if (tValue.isRequired === false) {
        // This is a resolved value now. w00t.
        // Use it, and execute the function.
        pResolver.log(3, 'Found ' + tValue.id + ' in exports. EXECUTE');

        tSideEffects = true;
        tPhase2Data = tReference.phase2;
        tReference.phase2 = null;

        for (j = 0, jl = tPhase2Data.length; j < jl; j++) {
          var tBackupKey = pResolver.currentKey;
          //pResolver.currentKey = tReference.reasonKey;
          pResolver.currentKey = tPhase2Data[j].closure.vm.name;
          tPhase2Data[j].closure.executeFunction(tValue, tPhase2Data[j].isNew, tPhase2Data[j].arguments, tReference.binding);
          pResolver.currentKey = tBackupKey;
        }

        // Done with this reference.
        tPhase2References.splice(i, 1);
        i--;
        il--;

        pResolver.log(3, 'Found ' + tValue.id + ' in exports. EXECUTE DONE');
      }
    }

    if (tSideEffects === true) {
      // The maps are all set up.
      // Try updating all stats again.
      updateStats(pResolver);
    }
  }

  function updateStats(pResolver) {
    var tStatsList = pResolver._stats;
    var tStats;
    var tData;
    var tBackupKey;
    var i, il, j, jl;
    var tIndex;

    for (i = 0, il = tStatsList.length; i < il; i++) {
      tStats = exportStats(tStatsList[i].vm.globalClosure, true, tStatsList[i].key);
      tData = tStatsList[i].data;

      for (j = 0, jl = tStats.requires.length; j < jl; j++) {
        if (tData.requires.indexOf(tStats.requires[j]) === -1) {
          tData.requires.push(tStats.requires[j]);
        }
      }

      for (j = 0, jl = tStats.exports.length; j < jl; j++) {
        if (tData.exports.indexOf(tStats.exports[j]) === -1) {
          tData.exports.push(tStats.exports[j]);

          tIndex = tData.requires.indexOf(tStats.exports[j]);

          if (tIndex !== -1) {
            tData.requires.splice(tIndex, 1);
          }
        }
      }

      updateVM(pResolver, tStats, pResolver.currentKey);

      pResolver.writeCache(tStatsList[i].key, tData);
    }
  }

  function printUnsortedStats(pResolver) {
    if (pResolver.verbosity < 1) {
      return;
    }

    pResolver.log(1, 'Unsorted Statistics:');

    var tStats = pResolver._stats;

    for (var i = 0, il = tStats.length; i < il; i++) {
      pResolver.log(1, '\n  ' + tStats[i].key + ':');

      if (tStats[i].data.requires.length === 0 && tStats[i].data.exports.length === 0) {
        pResolver.log(1, '    Nothing required and nothing exported');
      } else {
        if (tStats[i].data.requires.length !== 0) {
          pResolver.log(1, '    Requires:');
          pResolver.log(1, '      ' + tStats[i].data.requires.join('\n      '));
        }

        if (tStats[i].data.exports.length !== 0) {
          pResolver.log(1, '    Exports:');
          pResolver.log(1, '      ' + tStats[i].data.exports.join('\n      '));
        }
      }
    }

    pResolver.log(1, '\n');
  }

  function sortStats(pResolver, pOnlyExportsList) {
    var tUnsortedStats = pResolver._stats;
    var i, j, jl;
    var il = tUnsortedStats.length;
    // The sorted node list. (L)
    var tSorted = new Array();
    var tStatsPackage;
    var tStats;
    var tExports;
    var tExport;
    var tRequires;
    var tArray;
    var cExportMap = {};
    var cRequireMap = {};
    var tNode;
    var tStartNodes = [];
    var tLastIL;
    var tKeys;
    var tKey;

    printUnsortedStats(pResolver);

    function Node(pPackage) {
      this.package = pPackage;
      this.visited = false;
    }

    function visitDown(pNode) {
      var tRequireMap = cRequireMap;
      var i, il, j, jl;
      var tExports;
      var tExport;
      var tRequiringNodes;

      if (pNode.visited === false) {
        pNode.visited = true;
        tExports = pNode.package.data.exports;

        for (i = 0, il = tExports.length; i < il; i++) {
          tExport = tExports[i];

          if (!tRequireMap.hasOwnProperty(tExport)) {
            // Nobody requires this export. Skip.
            continue;
          }

          tRequiringNodes = tRequireMap[tExport];

          delete tRequireMap[tExport];

          /*
            for each node m with an edge from n to m do
                visit(m)
           */
          for (j = 0, jl = tRequiringNodes.length; j < jl; j++) {
            visitDown(tRequiringNodes[j]);
          }

          delete cExportMap[tExport];
        }

        tSorted.push(pNode.package.key);
      }
    }

    function visitUp(pNode) {
      if (pNode.visited === true) {
        return;
      }

      pNode.visited = true;

      var i, il;
      var tRequires = pNode.package.data.requires;
      var tKey;

      for (i = 0, il = tRequires.length; i < il; i++) {
        tKey = tRequires[i];

        if (!cExportMap.hasOwnProperty(tKey)) {
          continue;
        }

        visitUp(cExportMap[tKey]);
      }

      tSorted.push(pNode.package.key);
    }

    for (i = 0; i < il; i++) {
      tStatsPackage = tUnsortedStats[i];
      tStats = tStatsPackage.data;
      tExports = tStats.exports;
      tRequires = tStats.requires;

      tNode = new Node(tStatsPackage);

      // Make a map of all exported symbols to their files.
      for (j = 0, jl = tExports.length; j < jl; j++) {
        tKey = tExports[j];

        if (cExportMap.hasOwnProperty(tKey)) {
          pResolver.log(1, 'WARNING: ' + tKey + ' redelcared in ' + tStatsPackage.key);
        }

        cExportMap[tKey] = tNode;
      }

      // Make a map of all required symbols to their files.
      for (j = 0, jl = tRequires.length; j < jl; j++) {
        tKey = tRequires[j];
        tArray = cRequireMap[tKey] || (cRequireMap[tKey] = []);
        tArray.push(tNode);
      }

      // This creates the S set.
      if (!pOnlyExportsList && jl === 0) {
        tStartNodes.push(tNode);
      }
    }

    if (!pOnlyExportsList) {
      /*
        for each node n in S do
          visit(n)
       */

      for (i = 0, il = tStartNodes.length; i < il; i++) {
        visitDown(tStartNodes[i]);
      }

      // Next we try to visit nodes that
      // require something but also
      // export their own symbols.

      tKeys = Object.keys(cExportMap);
      il = tKeys.length;

      for (i = il - 1; i >= 0; i--) {
        tKey = tKeys[i];

        if (cExportMap.hasOwnProperty(tKey)) {
          visitDown(cExportMap[tKey]);
        }
      }

      // Finally we just append the remaining
      // sources that require something but
      // it was never defined in our sources.

      tKeys = Object.keys(cRequireMap);

      for (i = tKeys.length - 1; i >= 0; i--) {
        tArray = cRequireMap[tKeys[i]];

        for (j = tArray.length - 1; j >= 0; j--) {
          visitDown(tArray[j]);
        }
      }

      return tSorted.reverse();
    } else {
      for (i = 0, il = pOnlyExportsList.length; i < il; i++) {
        tExport = pOnlyExportsList[i];

        if (!cExportMap.hasOwnProperty(tExport)) {
          throwError(tExport + ' does not exist');
        }

        visitUp(cExportMap[tExport]);
      }

      return tSorted;
    }
  }

  function throwError(pMessage) {
    throw new Error(pMessage);
  }

}(typeof exports === 'object' ? exports : (this.rejs = {})));

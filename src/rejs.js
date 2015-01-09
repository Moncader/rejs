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

    this._stats = [];
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

    tVM = new VM(pResolver);
    tVM.execute(tAST);
    tStats = exportStats(tVM.globalClosure);

    pResolver._stats.push({
      key: pKey,
      data: tStats
    });

    pResolver.writeCache(pKey, tStats);

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

  function VM(pResolver) {
    this.resolver = pResolver;

    this.callStack = [];
    this.astStack = [];

    var tObjectPrototype = this.objectPrototype = new Value(true, false, void 0, null, true);
    tObjectPrototype.properties = {};

    var tGlobalObject = new Value(true, false, void 0, null, true);

    this.globalClosure = new Closure(this, new Reference(tGlobalObject), tGlobalObject, []);
  }

  tProto = VM.prototype;

  tProto.value = function(pPrototype) {
    return new Value(true, false, void 0, pPrototype || this.objectPrototype, false);
  };

  tProto.valueReference = function(pPrototype) {
    return new Reference(this.value(pPrototype));
  };

  tProto.literalReference = function(pLiteral) {
    return new Reference(new Value(true, false, pLiteral, this.objectPrototype, false));
  };

  tProto.undefinedReference = function() {
    return new Reference(new Value(true, false, void 0, this.objectPrototype, false));
  };

  tProto.requiredReference = function() {
    return new Reference(new Value(false, true, void 0, this.objectPrototype, false));
  };

  tProto.execute = function(pAST) {
    this.globalClosure.execute(pAST);
  };

  tProto.log = function(pVerbosity, pMessage) {
    this.resolver.log(pVerbosity, pMessage);
  };

  /////////////////////////////
  /// Values
  /////////////////////////////

  var mValueCounter = 0;

  function Value(pIsSet, pIsRequired, pLiteral, pProtoValue, pIsNative) {
    this.id = ++mValueCounter + '';
    this.literal = pLiteral;
    this.properties = null;
    this.proto = pProtoValue;
    this.isSet = pIsSet;
    this.isRequired = pIsRequired;
    this.isNative = pIsNative;
  }

  tProto = Value.prototype;

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

    if (tProperties !== null && pName in tProperties) {
      return tProperties[pName];
    }

    for (tProto = this.proto; tProto !== null; tProto = tProto.proto) {
      tProperties = tProto.properties;

      if (tProperties !== null && pName in tProperties) {
        return tProperties[pName];
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
    Value.call(this, true, false, void 0, pVM.objectPrototype, false);

    this.vm = pVM;
    this.parentClosures = pParentClosures;
    this.name = pName;
    this.args = pArguments;
    this.ast = pAST;

    this.setProperty('prototype', pVM.valueReference(pVM.objectPrototype));
  }

  tProto = FunctionValue.prototype = Object.create(Value.prototype);
  tProto.constructor = FunctionValue;

  tProto.instance = function() {
    var tInstance = new Closure(this.vm, void 0, this.vm.value(), this.parentClosures);
    var tArgumentNames;
    var i, il;

    if (this.name) {
      tInstance.local(this.name, new Reference(this));
    }

    tArgumentNames = this.args;

    if (tArgumentNames) {
      for (i = 0, il = tArgumentNames.length; i < il; i++) {
        tInstance.local(tArgumentNames[i], this.vm.undefinedReference());
      }
    }

    return tInstance;
  };

  /////////////////////////////
  /// References
  /////////////////////////////  

  function Reference(pValue) {
    this.value = pValue;
    this.isSet = false;
  }

  tProto = Reference.prototype;

  /////////////////////////////
  /// Closures
  /////////////////////////////

  function Closure(pVM, pThisReference, pLocals, pParentClosures) {
    this.vm = pVM;
    this.thisReference = pThisReference || new Reference(pVM.globalClosure.locals);
    this.futureThisReference = null;
    this.returnReference = this.undefinedReference();
    this.locals = pLocals;
    this.parentClosures = pParentClosures;
  }

  tProto = Closure.prototype;

  tProto.functionReference = function(pName, pArguments, pAST) {
    var tParentClosures = this.parentClosures.slice(0);
    tParentClosures.push(this);

    return new Reference(new FunctionValue(this.vm, tParentClosures, pName, pArguments, pAST));
  };

  tProto.valueReference = function(pPrototype) {
    return this.vm.valueReference(pPrototype);
  };

  tProto.literalReference = function(pLiteral) {
    return this.vm.literalReference(pLiteral);
  };

  tProto.reference = function(pValue) {
    return new Reference(pValue);
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

  tProto.log = function(pVerbosity, pMessage) {
    this.vm.log(pVerbosity, pMessage);
  };

  function preprocessAST(pClosure, pAST) {
    var tASTList;
    var tAST;
    var tType;
    var i, il, j, jl;
    var tKeys;
    var tValue;
    var tArguments;
    var tReference;

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
          tValue = tAST[tKeys[j]];

          if (typeof tValue === 'object' && tValue !== null) {
            preprocessAST(pClosure, tValue);
          }
        }
      }
    }
  }

  function interpret(pClosure, pAST) {
    var tASTList;
    var tAST;
    var i, il;
    var tVM = pClosure.vm;
    var tASTStack = tVM.astStack;
    var tType;
    var tResult = void 0;

    if (pAST.__proto__ !== Array.prototype) {
      tASTList = [pAST];
    } else {
      tASTList = pAST;
    }

    for (i = 0, il = tASTList.length; i < il; i++) {
      tAST = tASTList[i];
      tASTStack.push(tAST);

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
        // Panic for now.
        //throw new Error('Unsupported AST Type: ' + tType);
      }

      tASTStack.pop();
    }

    return tResult;
  }

  tProto.execute = function(pAST) {
    preprocessAST(this, pAST);

    return interpret(this, pAST);
  };


  /////////////////////////////
  /// AST Handlers
  /////////////////////////////


  tProto.Program = tProto.BlockStatement = function(pAST) {
    return interpret(this, pAST.body);
  };

  tProto.ExpressionStatement = function(pAST) {
    return interpret(this, pAST.expression);
  };

  tProto.EmptyExpression = function(pAST) {
    return this.literalReference(0);
  };

  tProto.NewExpression = tProto.CallExpression = function(pAST) {
    var tArgumentsAST = pAST.arguments;
    var tArgumentsReference = this.valueReference();
    var tArgumentsValue = tArgumentsReference.value;
    var tArgumentNames;
    var tCallee;
    var tCalleeInstance;
    var tThisReference;
    var i, il;

    for (i = 0, il = tArgumentsAST.length; i < il; i++) {
      tArgumentsValue.setProperty(i + '', interpret(this, tArgumentsAST[i]));
    }

    tCallee = interpret(this, pAST.callee);

    if (!(tCallee.value instanceof FunctionValue)) {
      return this.requiredReference();
    }

    tCalleeInstance = tCallee.value.instance();
    tCalleeInstance.local('arguments', tArgumentsReference);

    tArgumentNames = tCallee.value.args;

    for (i = 0, il = tArgumentNames.length; i < il; i++) {
      tCalleeInstance.local(tArgumentNames[i], tArgumentsValue.getProperty(i + '') || this.undefinedReference());
    }

    if (pAST.type === 'NewExpression') {
      tThisReference = tCalleeInstance.thisReference = this.valueReference(tCallee.value.getProperty('prototype').value);
      tThisReference.value.properties = {};

      tCalleeInstance.execute(tCallee.value.ast);

      return tThisReference;
    }


    if (this.futureThisReference !== null) {
      tCalleeInstance.thisReference = this.futureThisReference;
    }

    tCalleeInstance.execute(tCallee.value.ast);

    return tCalleeInstance.returnReference;
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
    var tLeftReference = interpret(this, pAST.left);
    var tRightReference = interpret(this, pAST.right);
    var tOperator = pAST.operator;

    switch (tOperator) {
      case '=':
        tLeftReference.value = tRightReference.value;
        tLeftReference.isSet = true;

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

  tProto.BinaryExpression = function(pAST) {
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
      case '<':
      case '>':
      case '<=':
      case '>=':
      case '==':
      case '===':
      case '!=':
      case '!==':
      case '&&':
      case '||':
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
      safePrint(this.vm.resolver, 0, pAST);
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
        this.log(0, 'Used an unresolved computed property in a MemberExpression. Possible resolution failure ahead!');

        return this.undefinedReference();
      }

      tName = tPropertyReference.value.asString();
    } else {
      if (pAST.property.type === 'Identifier') {
        tName = pAST.property.name;
      } else {
        tPropertyReference = interpret(this, pAST.property);

        if (!tPropertyReference.value.isSet) {
          this.log(0, 'Used an unresolved computed property in a MemberExpression. Possible resolution failure ahead!');

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

    this.futureThisReference = tObjectReference;

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
    var tObjectValue = new Value(true, false, void 0, this.vm.objectPrototype, false);
    var tProperties = pAST.properties;
    var i, il;

    tObjectValue.properties = {};

    for (i = 0, il = tProperties.length; i < il; i++) {
      tObjectValue.setProperty(tProperties[i].key.name, interpret(this, tProperties[i].value));
    }

    return this.reference(tObjectValue);
  };

  tProto.ArrayExpression = function(pAST) {
    var tArrayValue = new Value(true, false, void 0, this.vm.objectPrototype, false);
    var tElements = pAST.elements;
    var i, il;

    tArrayValue.properties = {};

    for (i = 0, il = tElements.length; i < il; i++) {
      tArrayValue.setProperty(i, interpret(this, tElements[i]));
    }

    return this.reference(tArrayValue);
  };

  tProto.IfStatement = function(pAST) {
    var tTestResult = interpret(this, pAST.test);
    var tConsequent = interpret(this, pAST.consequent);

    // TODO: Allow option for actually paying attention
    // to the test results.

    if (pAST.alternate) {
      return interpret(this, pAST.alternate);
    }

    return tConsequent;
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

  function exportStats(pClosure) {
    var tCache = {};
    var tNamespaceStack = [];
    var tRequires = [];
    var tExports = [];
    var tRootValue = true;

    function exportValue(pReference) {
      var tValue = pReference.value;
      var tKeys;
      var tProperties;
      var i, il;

      if (tRootValue === false) {
        if (pReference.isSet === true && tValue.isNative === false) {
          tExports.push(tNamespaceStack.join('.'));
        }

        if (tValue.id in tCache) {
          return;
        }

        if (tValue.isRequired === true && tValue.isNative === false/* && tNamespaceStack[tNamespaceStack.length - 1] !== 'prototype'*/) {
          tRequires.push(tNamespaceStack.join('.'));
        }
      } else {
        tRootValue = false;
      }

      tCache[tValue.id] = tValue;

      tProperties = tValue.properties;

      if (tProperties === null) {
        return;
      }

      tKeys = Object.keys(tProperties);

      for (i = 0, il = tKeys.length; i < il; i++) {
        tNamespaceStack.push(tKeys[i]);

        exportValue(tProperties[tKeys[i]]);

        tNamespaceStack.pop();
      }
    }

    exportValue(new Reference(pClosure.locals));

    return {
      requires: tRequires,
      exports: tExports
    };
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

  var mCache = [];

  function safePrint(pResolver, pVerbosity, pObject) {
    pResolver.log(pVerbosity, JSON.stringify(pObject, function(pKey, pValue) {
      if (typeof pValue === 'object' && pValue !== null) {
        if (mCache.indexOf(pValue) !== -1) {
          return '... (circular reference to object)';
        }

        mCache.push(pValue);
      } else if (typeof pValue === 'function') {
        if (mCache.indexOf(pValue) !== -1) {
          return '... (circular reference to function)';
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

    mCache.length = 0;
  }

}(typeof exports === 'object' ? exports : (this.rejs = {})));
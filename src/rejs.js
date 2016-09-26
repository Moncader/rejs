/**
 * @author Jason Parrott
 *
 * Copyright (C) 2014 ReJS Project.
 * This code is licensed under the zlib license. See LICENSE for details.
 */

(function(pAPI) {
  'use strict';

  pAPI.Resolver = Resolver;
  pAPI.ResolverKeyError = ResolverKeyError;
  pAPI.VM = VM;
  pAPI.Value = Value;
  pAPI.FunctionValue = FunctionValue;
  pAPI.NativeFunctionValue = NativeFunctionValue;
  pAPI.Reference = Reference;
  pAPI.Closure = Closure;

  var mAcorn;

  if (typeof acorn !== 'undefined') {
    mAcorn = acorn;
  } else {
    mAcorn = require('acorn');
  }

  var mAlphabetical;

  if (typeof alphabetical !== 'undefined') {
    mAlphabetical = alphabetical;
  } else {
    mAlphabetical = require('alphabetical');
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
    this._sources = [];
    this._unsortedSources = [];
    this._sortedSources = [];

    this.vm = new VM(this);
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
    var tUnsortedSources = pResolver._unsortedSources;
    var tSortedSources = pResolver._sortedSources;
    var tSourceCode;
    var tStatsIndex = findKeyStatsIndex(pResolver, pKey);
    var tStats;
    var tAST;
    var tVM = pResolver.vm;
    var i, il;

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
    tSourceCode = tReadFunction(pKey);

    if (tSourceCode === null || tSourceCode === void 0) {
      return 'Non existing source';
    } else if (typeof tSourceCode === 'string') {
      tAST = mAcorn.parse(tSourceCode, pResolver.acornOptions);
    } else if (typeof tSourceCode === 'object') {
      // This better be some AST
      tAST = tSourceCode;
    } else {
      return 'Invalid source';
    }

    tSource = new Source(pKey, tAST);
    tSource.AIL = toAILFromAST(tAST);
    pResolver._sources.push(tSource);

    
    if (tVM.execute(tSource, 0) === true) {
      tSortedSources.push(tSource);
    } else {
      tUnsortedSources.push(tSource);
    }

    for (i = 0, il = tUnsortedSources.length - 1; i < il; i++) {
      if (tVM.execute(tUnsortedSources[i], 0) === true) {
        tSortedSources.push(tUnsortedSources[i]);
        tUnsortedSources.splice(i--, 1);
        il--;
      }
    }

    /*tStats = exportStats(tVM.globalClosure);

    pResolver._stats.push({
      key: pKey,
      data: tStats
    });

    pResolver.writeCache(pKey, tStats);*/

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
    var tUnsortedSources = this._unsortedSources;
    var tSortedSources = this._sortedSources;
    var i;
    var il = tUnsortedSources.length;
    var tResult;
    var tVM = this.vm;

    while (il !== 0) {
      for (i = 0; i < il; i++) {
        if (tVM.execute(tUnsortedSources[i], 1) === true) {
          tSortedSources.push(tUnsortedSources[i]);
          tUnsortedSources.splice(i--, 1);
          il--;
        }
      }
    }

    il = tSortedSources.length;
    tResult = new Array(il);

    for (i = 0; i < il; i++) {
      tResult[i] = tSortedSources[i].key;
    }

    return tResult;
    //return sortStats(this, pExports || null);
  };


  /////////////////////////////////////////////////////////
  /// VM Code
  /////////////////////////////////////////////////////////
  
  /////////////////////////////
  /// IL
  /////////////////////////////
  
  var IL_NOOP = 0,
      IL_DECLARE = 1,
      IL_LITERAL = 2,
      IL_DEFINE = 3,
      IL_PUSH = 4,
      IL_POP = 5,
      IL_AST = 6,
      IL_IL = 7,
      IL_CALL = 8,
      IL_NEW = 9,
      IL_FUNCTION = 10,
      IL_UNDEFINED = 11,
      IL_OBJECT = 12,
      IL_ARRAY = 13,
      IL_PUSH_MULTI = 14,
      IL_POP_MULTI = 15;

  function IL() {
    this.code = [];
    this.stackIndex = 0;
    this.stackIndices = [];
  }

  var tProto = IL.prototype;

  tProto.saveStackIndex = function() {
    this.stackIndices.push(this.stackIndex);
  };

  tProto.restoreStackIndex = function() {
    var tDiff = this.stackIndex - this.stackIndices.pop();

    if (tDiff === 1) {
      this.POP();
    } else if (tDiff > 1) {
      this.POP_MULTI(tDiff);
    }
  };

  tProto.NOOP = function() {
    this.code.push(IL_NOOP);

    return this;
  };

  tProto.DECLARE = function(pName) {
    this.code.push(IL_DECLARE, pName);

    return this;
  };

  tProto.LITERAL = function(pValue) {
    this.code.push(IL_LITERAL, pValue);
    this.stackIndex++;

    return this;
  };

  tProto.DEFINE = function(pName) {
    this.code.push(IL_DEFINE, pName);
    this.stackIndex--;

    return this;
  };

  tProto.PUSH = function(pValue) {
    this.code.push(IL_PUSH, pValue);
    this.stackIndex++;

    return this;
  };

  tProto.POP = function() {
    this.code.push(IL_POP);
    this.stackIndex--;

    return this;
  };

  tProto.AST = function(pValue) {
    this.code.push(IL_AST, pValue);
    this.stackIndex++;

    return this;
  };

  tProto.IL = function(pValue) {
    this.code.push(IL_IL, pValue);
    this.stackIndex++;

    return this;
  };

  tProto.CALL = function() {
    this.code.push(IL_CALL);
    this.stackIndex++;

    return this;
  };

  tProto.NEW = function() {
    this.code.push(IL_NEW);
    this.stackIndex++;

    return this;
  };

  tProto.FUNCTION = function(pName, pArguments, pBody) {
    var tCode = this.code;
    var i;
    var il = pArguments.length;

    for (i = 0; i < il; i++) {
      tCode.push(pArguments[i]);
    }

    tCode.push(IL_PUSH_MULTI, il);
    tCode.push(IL_PUSH, pName);
    tCode.push(IL_AST, pBody);
    tCode.push(IL_FUNCTION);

    this.stackIndex -= il + 2;

    return this;
  };

  tProto.UNDEFINED = function() {
    this.code.push(IL_UNDEFINED);
    this.stackIndex++;

    return this;
  };

  tProto.OBJECT = function() {
    this.code.push(IL_OBJECT);
    this.stackIndex++;

    return this;
  };

  tProto.ARRAY = function(pSize) {
    this.code.push(IL_ARRAY, pSize);
    this.stackIndex++;

    return this;
  };

  tProto.PUSH_MULTI = function(pNumber) {
    this.code.push(IL_PUSH_MULTI, pNumber);

    for (var i = 1; i < pNumber; i++) {
      this.code.push(arguments[i]);
    }

    this.stackIndex += pNumber;

    return this;
  };

  tProto.POP_MULTI = function(pNumber) {
    this.code.push(IL_POP_MULTI, pNumber);
    this.stackIndex -= pNumber;

    return this;
  };

  tProto.RETURN_VOID = function() {
    this.code.push(IL_RETURN_VOID);
    this.stackIndex++;

    return this;
  };

  tProto.RETURN = function() {
    this.code.push(IL_RETURN);

    return this;
  };

  tProto.INCR = function() {
    this.code.push(IL_INCR);

    return this;
  };

  tProto.DECR = function() {
    this.code.push(IL_DECR);

    return this;
  };

  tProto.TYPEOF = function() {
    this.code.push(IL_TYPEOF);

    return this;
  };

  tProto.CONVERT_NUMBER = function() {
    this.code.push(IL_CONVERT_NUMBER);

    return this;
  };

  tProto.NEGATIVE = function() {
    this.code.push(IL_NEGATIVE);

    return this;
  };

  tProto.BITNOT = function() {
    this.code.push(IL_BITNOT);

    return this;
  };

  tProto.NOT = function() {
    this.code.push(IL_NOT);

    return this;
  };

  tProto.REPLACE = function() {
    this.code.push(IL_REPLACE);

    return this;
  };

  tProto.BITAND = function() {
    this.code.push(IL_BITAND);
    this.stackIndex--;

    return this;
  };

  tProto.BITXOR = function() {
    this.code.push(IL_BITXOR);
    this.stackIndex--;

    return this;
  };

  tProto.BITOR = function() {
    this.code.push(IL_BITOR);
    this.stackIndex--;

    return this;
  };

  tProto.ADD = function() {
    this.code.push(IL_ADD);
    this.stackIndex--;

    return this;
  };

  tProto.SUB = function() {
    this.code.push(IL_SUB);
    this.stackIndex--;

    return this;
  };

  tProto.MUL = function() {
    this.code.push(IL_MUL);
    this.stackIndex--;

    return this;
  };

  tProto.DIV = function() {
    this.code.push(IL_DIV);
    this.stackIndex--;

    return this;
  };

  tProto.MOD = function() {
    this.code.push(IL_MOD);
    this.stackIndex--;

    return this;
  };

  tProto.SHIFTL = function() {
    this.code.push(IL_SHIFTL);
    this.stackIndex--;

    return this;
  };

  tProto.SHIFTR = function() {
    this.code.push(IL_SHIFTR);
    this.stackIndex--;

    return this;
  };

  tProto.SHIFTRU = function() {
    this.code.push(IL_SHIFTRU);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN = function() {
    this.code.push(IL_ASSIGN);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_MUL = function() {
    this.code.push(IL_ASSIGN_MUL);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_DIV = function() {
    this.code.push(IL_ASSIGN_DIV);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_MOD = function() {
    this.code.push(IL_ASSIGN_MOD);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_ADD = function() {
    this.code.push(IL_ASSIGN_ADD);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_SUB = function() {
    this.code.push(IL_ASSIGN_SUB);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_SHIFTL = function() {
    this.code.push(IL_ASSIGN_SHIFTL);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_SHIFTR = function() {
    this.code.push(IL_ASSIGN_SHIFTR);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_SHIFTRU = function() {
    this.code.push(IL_ASSIGN_SHIFTRU);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_BITAND = function() {
    this.code.push(IL_ASSIGN_BITAND);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_BITXOR = function() {
    this.code.push(IL_ASSIGN_BITXOR);
    this.stackIndex--;

    return this;
  };

  tProto.ASSIGN_BITOR = function() {
    this.code.push(IL_ASSIGN_BITOR);
    this.stackIndex--;

    return this;
  };

  var mASTILMap = {};

  mASTILMap.Program = mASTILMap.BlockStatement = function(pAST, pIL) {
    var tBody = pAST.body;

    for (var i = 0, il = tBody.length; i < il; i++) {
      convertAST(tBody[i], pIL);
    }
  };

  mASTILMap.ExpressionStatement = function(pAST, pIL) {
    convertAST(pAST.expression, pIL);
  };

  mASTILMap.EmptyExpression = function(pAST, pIL) {
    
  };

  mASTILMap.NewExpression = mASTILMap.CallExpression = function(pAST, pIL) {
    var tArgumentsAST = pAST.arguments;
    var i;
    var il = tArgumentsAST.length;

    for (i = 0; i < il; i++) {
      convertAST(tArgumentsAST[i], pIL);
    }

    pIL.add(IL_PUSH, il);

    convertAST(pAST.callee, pIL);

    pIL.add(pAST.type === 'NewExpression' ? IL_NEW : IL_CALL);
  };

  mASTILMap.FunctionExpression = function(pAST, pIL) {
    var tKeys = pAST.params;
    var i;
    var il = tKeys.length;
    var tArguments = new Array(il);

    for (i = 0; i < il; i++) {
      tArguments[i] = tKeys[i].name;
    }

    pIL.FUNCTION(
      pAST.id ? pAST.id.name : null,
      tArguments,
      pAST.body
    );
  };

  mASTILMap.VariableDeclaration = function(pAST, pIL) {
    var tDeclarations = pAST.declarations;
    var tDeclaration;
    var i, il;

    for (i = 0, il = tDeclarations.length; i < il; i++) {
      tDeclaration = tDeclarations[i];

      if (tDeclaration.init) {
        convertAST(tDeclaration.init, pIL);
        pIL.add(IL_DEFINE, tDeclaration.id.name);
      } else {
        pIL.add(IL_DECLARE, tDeclaration.id.name);
      }
    }
  };

  mASTILMap.AssignmentExpression = function(pAST, pIL) {
    var tOperator = pAST.operator;

    convertAST(pAST.right, pIL);
    convertAST(pAST.left, pIL);

    switch (tOperator) {
      case '=':
        pIL.add(IL_ASSIGN);

        break;
      case '*=':
        pIL.add(IL_ASSIGN_MUL);

        break;
      case '/=':
        pIL.add(IL_ASSIGN_DIV);

        break;
      case '%=':
        pIL.add(IL_ASSIGN_MOD);

        break;
      case '+=':
        pIL.add(IL_ASSIGN_ADD);

        break;
      case '-=':
        pIL.add(IL_ASSIGN_SUB);

        break;
      case '<<=':
        pIL.add(IL_ASSIGN_SHIFTL);

        break;
      case '>>=':
        pIL.add(IL_ASSIGN_SHIFTR);

        break;
      case '>>>=':
        pIL.add(IL_ASSIGN_SHIFTRU);

        break;
      case '&=':
        pIL.add(IL_ASSIGN_BITAND);

        break;
      case '^=':
        pIL.add(IL_ASSIGN_BITXOR);

        break;
      case '|=':
        pIL.add(IL_ASSIGN_BITOR);

        break;
      default:
        //this.log(2, 'Unsupported AssignmentExpression Operator: ' + tOperator);

        break;
    }
  };

  mASTILMap.BinaryExpression = function(pAST, pIL) {
    convertAST(pAST.left, pIL);
    convertAST(pAST.right, pIL);

    var tOperator = pAST.operator;

    switch (tOperator) {
      case '+':
        pIL.ADD();

        break;
      case '-':
        pIL.SUB();

        break;
      case '*':
        pIL.MUL();

        break;
      case '/':
        pIL.DIV();

        break;
      case '%':
        pIL.MOD();

        break;
      case '<<':
        pIL.SHIFTL();

        break;
      case '>>':
        pIL.SHIFTR();

        break;
      case '>>>':
        pIL.SHIFTRU();

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
        pIL.POP().REPLACE(false);

        break;
      case '&':
        pIL.BITAND();

        break;
      case '^':
        pIL.BITXOR();

        break;
      case '|':
        pIL.BITOR();

        break;
      default:
        //this.log(2, 'Unsupported BinaryExpression Operator: ' + tOperator);

        break;
    }
  };

  mASTILMap.UnaryExpression = function(pAST, pIL) {
    var tOperator = pAST.operator;

    convertAST(pAST.argument, pIL);

    switch (tOperator) {
      case 'delete':
        // Don't actually delete anything.
        pIL.PUSH(true);

        break;
      case 'void':
        pIL.UNDEFINED();

        break;
      case 'typeof':
        pIL.TYPEOF();
        
        break;
      case '+':
        pIL.CONVERT_NUMBER();

        break;
      case '-':
        pIL.NEGATIVE();

        break;
      case '~':
        pIL.BITNOT();

        break;
      case '!':
        pIL.NOT();

        break;
      default:
        //this.log(2, 'Unsupported UnaryExpression Operator: ' + tOperator);

        break;
    }
  };

  mASTILMap.UpdateExpression = function(pAST, pIL) {
    var tOperator = pAST.operator;

    convertAST(pAST.argument);

    if (tOperator === '++') {
      pIL.INCR();
    } else if (tOperator === '--') {
      pIL.DECR();
    } else {
      //this.log(2, 'Unsupported UpdateExpression Operator: ' + tOperator);
    }
  };

  mASTILMap.MemberExpression = function(pAST, pIL) {

  };

  mASTILMap.Identifier = function(pAST, pIL) {
    
  };

  mASTILMap.ThisExpression = function(pAST, pIL) {
    
  };

  mASTILMap.Literal = function(pAST, pIL) {
    
  };

  mASTILMap.ObjectExpression = function(pAST, pIL) {
    
  };

  mASTILMap.ArrayExpression = function(pAST, pIL) {
    
  };

  mASTILMap.IfStatement = function(pAST, pIL) {
    
  };

  mASTILMap.ForInStatement = function(pAST, pIL) {
    
  };

  mASTILMap.ForStatement = function(pAST, pIL) {
    var i, il;

    if (pAST.init) {
      pIL.saveStackIndex();
      convertAST(pAST.init, pIL);
      pIL.restoreStackIndex();
    }

    if (pAST.test) {
      pIL.saveStackIndex();
      convertAST(pAST.test, pIL);
      pIL.restoreStackIndex();
    }

    if (pAST.update) {
      pIL.saveStackIndex();
      convertAST(pAST.update, pIL);
      pIL.restoreStackIndex();
    }

    // TODO: Provide option actually run this loop.
    
    if (pAST.body instanceof Array) {
      for (i = 0, il = pAST.body.length; i < il; i++) {
        convertAST(pAST.body[i], pIL);
      }
    } else {
      convertAST(pAST.body, pIL);
    }
  };

  mASTILMap.ReturnStatement = function(pAST, pIL) {
    if (pAST.argument === null) {
      pIL.RETURN_VOID();
    } else {
      pIL.RETURN();
    }
  };

  function hoistAST(pAST, pAIL) {
    var i, il, j, jl;
    var tAST;
    var tType;
    var tKeys;
    var tValue;

    for (i = 0, il = pAST.length; i < il; i++) {
      tAST = pAST[i];
      tType = tAST.type;

      if (tType === 'VariableDeclarator') {
        pAIL.add(IL_DECLARE, tAST.id.name);
      } else if (tType === 'FunctionDeclaration') {
        tKeys = tAST.params;
        jl = tKeys.length;

        pAIL.add(IL_PUSH_MULTI, jl);

        for (j = 0; j < jl; j++) {
          pAIL.add(tKeys[j].name);
        }

        pAIL
        .add(IL_AST, pAST.body)
        .add(IL_PUSH, pAST.id ? pAST.id.name : null)
        .add(IL_FUNCTION);

        pAIL.add(IL_DEFINE, tAST.id.name);
      } else if (tType === 'FunctionExpression') {
        // Ignore things that make their own Closure.
      } else {
        // Attempt to process everything else.
        tKeys = Object.keys(tAST);

        for (j = 0, jl = tKeys.length; j < jl; j++) {
          tValue = tAST[tKeys[j]];

          if (typeof tValue === 'object' && tValue !== null) {
            hoistAST(tValue, pAIL);
          }
        }
      }
    }
  }

  function convertAST(pAST, pAIL) {
    var i, il, j, jl;
    var tAST;
    var tType;
    var tASTProperties = mASTProperties;
    var tASTPropertiesLength = tASTProperties.length;

    for (i = 0, il = pAST.length; i < il; i++) {
      tAST = pAST[i];
      tType = tAST.type;

      if (tType === 'FunctionDeclaration' || tType === 'VariableDeclarator') {
        continue;
      }

      if (tType in mASTILMap) {
        mASTILMap[tType](tAST, pAIL);
      } else {
        for (j = 0; j < tASTPropertiesLength; j++) {
          if (tAST[tASTProperties[j]]) {
            convertAST(tAST[tASTProperties[j]], pAIL);
          }
        }
        // Panic for now.
        //throw new Error('Unsupported AST Type: ' + tType);
      }
    }
  }

  function toAILFromAST(pAST) {
    var tAIL = new mAlphabetical.AIL();
    var tASTList;
    var tAST;
    var i, il;

    if (pAST.__proto__ !== Array.prototype) {
      tASTList = [pAST];
    } else {
      tASTList = pAST;
    }

    hoistAST(tASTList, tAIL);
    convertAST(tASTList, tAIL);

    return tAIL;
  }

  /////////////////////////////
  /// Source
  /////////////////////////////

  function Source(pKey, pAST) {
    this.key = pKey;
    this.ast = pAST;
    this.ail = null;
  }

  /////////////////////////////
  /// VM
  /////////////////////////////

  function createPrototypes(pVM) {
    var tObjectPrototype = pVM.objectPrototype = pVM.value(null);
    tObjectPrototype.properties = {};

    var tFunctionPrototype = pVM.functionPrototype = pVM.value(tObjectPrototype);

    tFunctionPrototype.setProperty('call', pVM.reference(new NativeFunctionValue(pVM, function(pThisReference) {
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
    })));
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
            source: tValue.source.key,
            resolved: tValue.constructor !== UnresolvedValue
          });
        }
      }
    }));
  }

  function VM(pResolver) {
    this.resolver = pResolver;
    this.program = new mAlphabetical.Program();
    this.currentASTSource = this.currentExecutionSource = this.nativeSource = new Source('', []);

    createPrototypes(this);

    var tGlobalObject = this.value(null);

    this.globalClosure = new Closure(this, new Reference(tGlobalObject), tGlobalObject, []);

    createRejsNamespace(this);
  }

  tProto = VM.prototype;

  tProto.reference = function(pValue) {
    return new Reference(pValue);
  }

  tProto.value = function(pPrototype) {
    return new Value(void 0, pPrototype === void 0 ? this.objectPrototype : pPrototype, this.currentASTSource, this.currentExecutionSource);
  };

  tProto.valueReference = function(pPrototype) {
    return new Reference(this.value(pPrototype));
  };

  tProto.literalReference = function(pLiteral) {
    return new Reference(new Value(pLiteral, this.objectPrototype, this.currentASTSource, this.currentExecutionSource));
  };

  tProto.undefinedReference = function() {
    return new Reference(new Value(void 0, this.objectPrototype, this.currentASTSource, this.currentExecutionSource));
  };

  tProto.functionReference = function(pParentClosures, pName, pArguments, pAST) {
    return new Reference(new FunctionValue(this.vm, pParentClosures, pName, pArguments, pAST, this.currentASTSource, this.currentExecutionSource));
  };

  tProto.unresolvedReference = function() {
    return new Reference(new UnresolvedValue(this.currentASTSource, this.currentExecutionSource));
  };

  tProto.execute = function(pSource) {
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
        return new Reference(pData);
      } else {
        tType = typeof pData;

        if (tType === 'object') {
          if ((tIndex = tObjects.indexOf(pData)) >= 0) {
            return new Reference(tValues[tIndex]);
          }

          // Convert this object to our own system manually.
          
          tValue = new Value(true, false, void 0, pData.__proto__ === null ? null : wrap(pData.__proto__), true);
          tObjects.push(pData);
          tValues.push(tValue);

          tKeys = Object.keys(pData);

          for (i = 0, il = tKeys.length; i < il; i++) {
            tValue.setProperty(tKeys[i], wrap(pData[tKeys[i]]));
          }

          return new Reference(tValue);
        } else if (tType === 'function') {
          if ((tIndex = tObjects.indexOf(pData)) >= 0) {
            return new Reference(tValues[tIndex]);
          }

          if (pConvertFunctions) {
            // TODO: Attempt to get the source code via toString
            // then ASTize it, and make a new FunctionValue.
            return tVM.undefinedReference();
          }

          tValue = new NativeFunctionValue(tVM, pData);
          tObjects.push(pData);
          tValues.push(tValue);

          return new Reference(tValue);
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

  function Value(pLiteral, pProtoValue, pASTSource, pExecutionSource) {
    this.id = ++mValueCounter + '';
    this.literal = pLiteral;
    this.properties = null;
    this.proto = pProtoValue;
    this.astSource = pASTSource;
    this.executionSource = pExecutionSource;
  }

  tProto = Value.prototype;

  tProto.setLiteral = function(pValue) {
    this.literal = pValue;
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

  function FunctionValue(pVM, pParentClosures, pName, pArguments, pAST, pASTSource, pExecutionSource) {
    Value.call(this, void 0, pVM.functionPrototype, pASTSource, pExecutionSource);

    this.vm = pVM;
    this.parentClosures = pParentClosures;
    this.name = pName;
    this.args = pArguments;
    this.ast = pAST;

    this.setProperty('prototype', pVM.valueReference(pVM.objectPrototype));
  }

  tProto = FunctionValue.prototype = Object.create(Value.prototype);
  tProto.constructor = FunctionValue;

  tProto.instance = function(pThisReference, pArguments) {
    var tInstance = new Closure(this.vm, pThisReference, this.vm.value(), this.parentClosures);
    var tArgumentsReference = tInstance.valueReference();
    var tArgumentsValue = tArgumentsReference.value;
    var tArgumentNames;
    var i, il;

    tInstance.ast = this.ast;

    if (this.name) {
      tInstance.local(this.name, new Reference(this));
    }

    for (i = 0, il = pArguments.length; i < il; i++) {
      tArgumentsValue.setProperty(i + '', pArguments[i]);
    }

    tInstance.local('arguments', tArgumentsReference);

    tArgumentNames = this.args;

    if (tArgumentNames) {
      for (i = 0, il = tArgumentNames.length; i < il; i++) {
        tInstance.local(tArgumentNames[i], pArguments[i] || this.vm.undefinedReference());
      }
    }

    return tInstance;
  };

  /////////////////////////////
  /// Unresolved Value
  /////////////////////////////

  function UnresolvedValue(pASTSource, pExecutionSource) {
    Value.call(this, void 0, null, pASTSource, pExecutionSource);
  }

  tProto = UnresolvedValue.prototype = Object.create(Value.prototype);
  tProto.constructor = UnresolvedValue;

  /////////////////////////////
  /// NativeFunction Value
  /////////////////////////////

  function NativeFunctionValue(pVM, pCallback) {
    FunctionValue.call(this, pVM, [], void 0, [], [
      {
        type: 'rejsNativeCallback',
        callback: pCallback
      }
    ], pVM.nativeSource, pVM.nativeSource);
  }

  tProto = NativeFunctionValue.prototype = Object.create(FunctionValue.prototype);
  tProto.constructor = NativeFunctionValue;

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
    this.ast = null;
    this.astSource = pVM.currentASTSource;
  }

  tProto = Closure.prototype;

  tProto.functionReference = function(pName, pArguments, pAST) {
    var tParentClosures = this.parentClosures.slice(0);
    tParentClosures.push(this);

    return this.vm.functionReference(tParentClosures, pName, pArguments, pAST);
  };

  tProto.valueReference = function(pPrototype) {
    return this.vm.valueReference(pPrototype);
  };

  tProto.literalReference = function(pLiteral) {
    return this.vm.literalReference(pLiteral);
  };

  tProto.reference = function(pValue) {
    return this.vm.reference(pValue);
  };

  tProto.local = function(pName, pReference) {
    this.locals.setProperty(pName, pReference);
  };

  tProto.undefinedReference = function() {
    return this.vm.undefinedReference();
  };

  tProto.unresolvedReference = function() {
    return this.vm.unresolvedReference();
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
        // Panic for now.
        //throw new Error('Unsupported AST Type: ' + tType);
      }
    }

    return tResult;
  }

  tProto.execute = function(pAST) {
    pAST = pAST || this.ast || [];

    preprocessAST(this, pAST);

    return interpret(this, pAST);
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

  tProto.EmptyExpression = function(pAST) {
    return this.literalReference(0);
  };

  tProto.NewExpression = tProto.CallExpression = function(pAST) {
    var tArgumentsAST = pAST.arguments;
    var tArguments = [];
    var tCalleeValue;
    var tCalleeInstance;
    var tThisReference;
    var i, il;

    for (i = 0, il = tArgumentsAST.length; i < il; i++) {
      tArguments[i] = interpret(this, tArgumentsAST[i]);
    }

    tCalleeValue = interpret(this, pAST.callee).value;



    if (!(tCalleeValue instanceof FunctionValue)) {
      if (tCalleeValue.isSet === false) {
        //tCalleeValue
      }

      // TODO: Do we need to track this to to resolve
      // order later?
      return this.requiredReference();
    }

    if (pAST.type === 'NewExpression') {
      tThisReference = this.valueReference(tCalleeValue.getProperty('prototype').value);
      tThisReference.value.properties = {};

      tCalleeInstance = tCalleeValue.instance(tThisReference, tArguments);
      tCalleeInstance.execute();

      return tThisReference;
    }

    if (this.futureThisReference !== null) {
      tThisReference = this.futureThisReference;
    }

    tCalleeInstance = tCalleeValue.instance(tThisReference, tArguments);
    tCalleeInstance.execute();

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
    var tRightReference = interpret(this, pAST.right);
    var tLeftReference = interpret(this, pAST.left);
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

          if (tValue.id in tCache) {
            return;
          }
        } else if (tValue.isRequired === true && tValue.isNative === false && !(tValue.id in tCache)) {
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

}(typeof exports === 'object' ? exports : (this.rejs = {})));
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

  function Resolver(pOptions) {
    this.readCache = pOptions.readCache || null;
    this.writeCache = pOptions.writeCache || null;
    this.acornOptions = pOptions.acornOptions;
    this.log = pOptions.log || function() {};
  }

  var tProto = Resolver.prototype;

  tProto.resolve = function(pResources) {
    var tKeys = Object.keys(pResources);
    var i;
    var il = tKeys.length;
    var tKey;
    var tSource = '';
    var tStatsString, tStats;
    var tUnsortedStats = new Array(il);
    var tSortedStats = new Array(il);
    var tDoCache = this.readCache !== null && this.writeCache !== null;
    var tAST;
    var tAcornOptions = this.acornOptions;
    var tVM;
    var tDefaultMembers;
    var tGlobalScope;

    for (i = 0; i < il; i++) {
      tKey = tKeys[i];

      if (tDoCache && (tStatsString = this.readCache(tKey)) !== null) {
        tUnsortedStats[i] = {
          key: tKey,
          stats: JSON.parse(tStatsString)
        };
      } else {
        tAST = mAcorn.parse(pResources[tKey], tAcornOptions);

        tVM = new VM(this);
        tVM.globalScope.addAST(tAST);
        tVM.globalScope.interpret();

        tStats = this.exportStats(tVM.globalScope);

        tUnsortedStats[i] = {
          key: tKey,
          stats: tStats
        };

        delete tStats.global;

        if (tDoCache) {
          this.writeCache(tKey, JSON.stringify(tStats));
        }
      }
    }

    return this.sortStats(tUnsortedStats);
  };

  var mGlobalScopeASTCache = null;

  tProto.exportStats = function(pScope) {
    var tSelf = this;
    var tCache = [];
    var tValueCache = [];
    var tNamespaceStack = [];
    var tRequires = [];
    var tExports = [];

    function exportObject(pObject) {
      if (!pObject) {
        tSelf.log(tNamespaceStack.join('.'));
      }

      var tValue = pObject.value;
      var tType = typeof tValue;
      var tReturn;
      var tIndex;
      var tObject;
      var tKeys;
      var i, il, k;

      if (pObject.isRequired === true && pObject.isNative === false && tNamespaceStack[tNamespaceStack.length - 1] !== 'prototype') {
        tRequires.push(tNamespaceStack.join('.'));
      }

      if (pObject.isSet === true && tNamespaceStack.length > 0 && pObject.isNative === false) {
        tExports.push(tNamespaceStack.join('.'));
      }

      if (tType === 'undefined') {
        if (!pObject.isSet) {
          return void 0;
        }

        return '__undefined__';
      } else if (tValue === null) {
        if (!pObject.isSet) {
          return void 0;
        }

        return null;
      } else if (tType === 'object' || tType === 'function') {
        if (tValue.__proto__ === Array.prototype) {
          if ((tIndex = tCache.indexOf(tValue)) !== -1) {
            return tValueCache[tIndex];
          }

          tReturn = new Array(tValue.length);

          tCache.push(tValue);
          tValueCache.push(tReturn);

          for (i = 0, il = tValue.length; i < il; i++) {
            tObject = exportObject(tValue[i]);

            if (tObject !== void 0) {
              tReturn[i] = tObject;
            }
          }

          return tReturn;
        } else {
          if ((tIndex = tCache.indexOf(tValue)) !== -1) {
            return tValueCache[tIndex];
          }

          tReturn = {};

          tCache.push(tValue);
          tValueCache.push(tReturn);

          tKeys = Object.keys(tValue);

          for (i = 0, il = tKeys.length; i < il; i++) {
            tNamespaceStack.push(tKeys[i]);

            tObject = exportObject(tValue[tKeys[i]]);

            if (tObject !== void 0) {
              tReturn[tKeys[i]] = tObject;
            }

            tNamespaceStack.pop();
          }

          if (tType === 'function') {
            tReturn.prototype = {};

            tValue = tValue.prototype.value;

            if (!tValue) {
              return tReturn;
            }

            tNamespaceStack.push('prototype');

            tKeys = Object.keys(tValue);

            for (i = 0, il = tKeys.length; i < il; i++) {
              tNamespaceStack.push(tKeys[i]);
              tObject = exportObject(tValue[tKeys[i]]);

              if (tObject !== void 0) {
                tReturn.prototype[tKeys[i]] = tObject;
              }

              tNamespaceStack.pop();
            }

            tNamespaceStack.pop();
          }

          return tReturn;
        }
      } else {
        if (!pObject.isSet) {
          return void 0;
        }

        return tValue;
      }
    }

    return {
      global: exportObject(pScope.members),
      requires: tRequires,
      exports: tExports
    };
  }

  tProto.sortStats = function(pUnsortedStats) {
    var i, j, jl;
    var il = pUnsortedStats.length;
    // The sorted node list. (L)
    var tSorted = new Array();
    var tStatsPackage;
    var tStats;
    var tExports;
    var tRequires;
    var tArray;
    var cExportMap = {};
    var cRequireMap = {};
    var tNode;
    var tStartNodes = [];

    function Node(pPackage) {
      this.package = pPackage;
      this.visited = false;
    }

    function visit(pNode) {
      var tRequireMap = cRequireMap;
      var i, il, j, jl;
      var tExports;
      var tRequiringNodes;

      if (pNode.visited === false) {
        pNode.visited = true;
        tExports = pNode.package.stats.exports;

        for (i = 0, il = tExports.length; i < il; i++) {
          tRequiringNodes = tRequireMap[tExports[i]];

          if (tRequiringNodes === void 0) {
            // Nobody requires this export. Skip.
            continue;
          }

          delete tRequireMap[tExports[i]];

          /*
            for each node m with an edge from n to m do
                visit(m)
           */
          for (j = 0, jl = tRequiringNodes.length; j < jl; j++) {
            visit(tRequiringNodes[j]);
          }
        }

        tSorted.push(pNode.package.key);
      }
    }

    for (i = 0; i < il; i++) {
      tStatsPackage = pUnsortedStats[i];
      tStats = tStatsPackage.stats;
      tExports = tStats.exports;
      tRequires = tStats.requires;

      tNode = new Node(tStatsPackage);

      // Make a map of all exported symbols to their files.
      for (j = 0, jl = tExports.length; j < jl; j++) {
        if (tExports[j] in cExportMap) {
          this.log('WARNING: ' + tExports[j] + ' redelcared in ' + tStatsPackage.key);
        }

        cExportMap[tExports[j]] = tNode;
      }

      // Make a map of all required symbols to their files.
      for (j = 0, jl = tRequires.length; j < jl; j++) {
        tArray = cRequireMap[tRequires[j]] = (cRequireMap[tRequires[j]] || []);
        tArray.push(tNode);
      }

      // This creates the S set.
      if (tStats.requires.length === 0) {
        tStartNodes.push(tNode);
      }
    }

    /*
      for each node n in S do
        visit(n)
     */
    for (i = 0, il = tStartNodes.length; i < il; i++) {
      visit(tStartNodes[i]);
    }

    if (Object.keys(cRequireMap).length > 0) {
      this.log('UNRESOLVED REQUIREMENTS');
      
      this.safePrint(Object.keys(cRequireMap));
    }

    return tSorted.reverse();
  };

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

  function VM(pResolver) {
    this.nativeMode = false;
    this.log = pResolver.log;
    
    var tExternsJS = '';
    var tGlobalScope;
    var tPredefines;

    this.nativeMode = true;

    tPredefines = this.createValue({});

    this.globalScope = tGlobalScope = new Scope(this, tPredefines, []);
    tGlobalScope.members = tPredefines;

    tGlobalScope.interpret();

    this.nativeMode = false;
  }

  VM.prototype.createValue = function(pValue, pIsSet, pIsLiteral) {
    return new Value(this, pValue, pIsSet, pIsLiteral);
  };

  VM.prototype.UNDEFINED = function() {
    return new Value(this, {}, false);
  };

  /**
   * @constructor
   */
  function Scope(pVM, pThisMember, pScopeChain) {
    this.vm = pVM;
    this.scopeChain = pScopeChain;

    if (!(pThisMember instanceof Value)) {
      pThisMember = pVM.createValue(pThisMember);
    }

    this.thisMember = pThisMember;
    this.members = pVM.createValue({});
    this.returnValue = pVM.createValue(void 0);
    this.ast = [];
  }

  var p = Scope.prototype;

  p.clone = function() {
    var tScope = new Scope(this.vm, this.thisMember, this.scopeChain);
    tScope.members.copy(this.members);
    tScope.returnValue = this.returnValue;
    tScope.ast = this.ast;

    return tScope;
  };

  p.newChildScope = function(pThisMember) {
    var tScope = new Scope(this.vm, pThisMember, this.scopeChain.slice(0));
    tScope.scopeChain.push(this);

    return tScope;
  };

  p.assign = function(pName, pValue) {
    if (pName instanceof Value) {
      pName = pName.value;
    }

    this.members.value[pName] = pValue;
  };

  p.resolve = function(pValue) {
    var tScope = this;
    var tScopes = tScope.scopeChain;
    var i;
    var tName;

    if (pValue instanceof Value) {
      if (pValue.isLiteral) {
        return pValue;
      }

      if (typeof pValue.value !== 'string') {
        return pValue;
      }

      tName = pValue.value;
    } else {
      tName = pValue;
      pValue = this.vm.UNDEFINED();
    }

    if (tScope.members.value.hasOwnProperty(tName)) {
      return tScope.members.value[tName];
    }

    for (i = tScopes.length - 1; i >= 0; i--) {
      tScope = tScopes[i];
      
      if (tScope.members.value.hasOwnProperty(tName)) {
        return tScope.members.value[tName];
      }
    }

    pValue = this.vm.createValue({}, false, false);

    tScope.assign(tName, pValue);

    return pValue;
  };

  p.addAST = function(pASTArray) {

    var tSelf = this;

    function preProcessAST(pAST) {
      var tType;
      var tAST;
      var tNewScope;
      var i, il, j;
      var tFunction;
      var tTemp;

      var tASTProperties = mASTProperties;
      var tASTPropertiesLength = tASTProperties.length;

      if (pAST.__proto__ !== Array.prototype) {
        pAST = [pAST];
      }

      for (i = 0, il = pAST.length; i < il; i++) {
        tAST = pAST[i];
        tType = tAST.type;

        if (tType === 'VariableDeclarator') {
          tSelf.assign(tAST.id.name, tSelf.vm.UNDEFINED());
        } else if (tType === 'FunctionDeclaration') {
          tNewScope = tSelf.newChildScope({});
          tFunction = createFunction(tSelf.vm, tNewScope, tAST.id.name, tAST.params, tAST.body);
          tNewScope.thisMember = tFunction;

          tSelf.assign(tAST.id.name, tFunction);

          if (tSelf.vm.nativeMode === true && tSelf.scopeChain.length === 0) {
            // Hacks to populate the VM.
            switch (tAST.id.name) {
              case 'Object':
                tTemp = tSelf.objectPrototype = tNewScope.resolve('prototype');

                break;
              case 'Function':
                tTemp = tSelf.functionPrototype = tNewScope.resolve('prototype');

                break;
            }
          }
        } else if (tType === 'FunctionExpression') {
          // ignore
        } else {
          for (j = 0; j < tASTPropertiesLength; j++) {
            if (tAST[tASTProperties[j]]) {
              preProcessAST(tAST[tASTProperties[j]]);
            }
          }
        }
      }
    }

    if (pASTArray.__proto__ !== Array.prototype) {
      pASTArray = [pASTArray];
    }

    this.ast = this.ast.concat(pASTArray);

    preProcessAST(pASTArray);
  };

  p.interpret = function() {
    var tASTArray = this.ast;
    var tAST;
    var i, il;

    for (i = 0, il = tASTArray.length; i < il; i++) {
      tAST = tASTArray[i];
      this.handle(tAST);
    }
  };

  p.handle = function(pAST) {
    var tType = pAST.type;
    var tResolved;

    if (tType in this) {
      return this[tType](pAST);
    }

    if (tType === 'FunctionDeclaration' || tType === 'EmptyStatement') {
      return this.vm.UNDEFINED();
    }

    // Default handler
    tResolved = this.vm.UNDEFINED();

    var tASTProperties = mASTProperties;
    var tASTPropertiesLength = tASTProperties.length;

    for (var i = 0; i < tASTPropertiesLength; i++) {
      if (pAST[tASTProperties[i]]) {
        tResolved = this.handle(pAST[tASTProperties[i]]);
      }
    }
    return tResolved;
  };

  p.handleAndResolve = function(pAST) {
    var tResult = this.handle(pAST);
    
    return this.resolve(tResult);
  };

  // HANDLERS FOR AST

  p.Program = p.BlockStatement = function(pAST) {
    var tArray = pAST.body;

    for (var i = 0, il = tArray.length; i < il; i++) {
      this.handle(tArray[i]);
    }
  };

  p.ExpressionStatement = function(pAST) {
    return this.handle(pAST.expression);
  };

  p.NewExpression = p.CallExpression = function(pAST) {
    var tArray = pAST.arguments;
    var tArray2 = [];
    var tResolved;
    var tReturn;
    var tPrototype;
    var tNewThis;
    var i, il, k;
    var tScope;
    var tBackupScope = null;

    for (i = 0, il = tArray.length; i < il; i++) {
      tResolved = tArray2[i] = this.handleAndResolve(tArray[i]);

      if (!tResolved.isSet) {
        if (!tResolved.isRequired) {
          tResolved.require();
        }
      }
    }

    tResolved = this.handleAndResolve(pAST.callee);

    if (!tResolved.isSet) {
      if (!tResolved.isRequired) {
        tResolved.require();
      }

      tResolved = createFunction(this.vm, this.newChildScope({}), null, [], []);
    }

    tScope = tResolved.scope;

    if (!tScope) {
      return this.vm.UNDEFINED();
    }

    if (pAST.type === 'NewExpression') {
      tBackupScope = tScope;
      tScope = tResolved.scope = tScope.clone();
      tScope.members = this.vm.createValue({});
      tPrototype = tResolved.value.prototype;
      tNewThis = tScope.thisMember = this.vm.createValue({});

      for (k in tPrototype.value) {
        tNewThis.value[k] = tPrototype.value[k].newCopy();
        tNewThis.value[k].isSet = true;
        tNewThis.value[k].isRequired = false;
      }

      tNewThis.proto = tPrototype;
    }

    tScope.assign('arguments', this.vm.createValue(tArray2));

    tReturn = tResolved.value(tScope);

    if (tBackupScope !== null) {
      tResolved.scope = tBackupScope;
    }

    if (pAST.type === 'NewExpression') {
      return tScope.thisMember;
    }

    return tReturn;
  };

  p.FunctionExpression = function(pAST) {
    var tNewScope = this.newChildScope({});
    var tFunction = createFunction(this.vm, tNewScope, pAST.id ? pAST.id.name : void 0, pAST.params, pAST.body);
    tNewScope.thisMember = tFunction;

    return tFunction;
  };

  p.VariableDeclaration = function(pAST) {
    var tArray = pAST.declarations;
    var tResolved;
    var i, il;

    for (i = 0, il = tArray.length; i < il; i++) {
      if (tArray[i].init) {
        tResolved = this.handleAndResolve(tArray[i].init);

        if (!tResolved.isSet) {
          if (!tResolved.isRequired) {
            tResolved.require();
          }

          this.assign(tArray[i].id.name, this.vm.createValue(tResolved.value));
        } else {
          this.assign(tArray[i].id.name, tResolved);
        }
      } else {
        tResolved = this.vm.createValue(void 0);
        this.assign(tArray[i].id.name, tResolved);
      }
    }

    return tResolved;
  };

  p.AssignmentExpression = function(pAST) {
    var tResolved = this.handleAndResolve(pAST.left);
    var tResolved2 = this.handleAndResolve(pAST.right);

    if (!tResolved2.isSet && !tResolved2.isRequired) {
      tResolved2.require();
    }

    tResolved.copy(tResolved2);

    return tResolved;
  };

  function resolveInPrototypeChain(pChain, pName) {
    if (!pChain.value) {
      return pChain.vm.UNDEFINED();
    }

    var tValue = pChain.value[pName];

    if (tValue) {
      return tValue;
    }

    if (pChain.proto) {
      return resolveInPrototypeChain(pChain.proto, pName);
    }

    return pChain.vm.UNDEFINED();
  }

  p.MemberExpression = function(pAST) {
    var tName;
    var tProperty;
    var tResolved = this.handleAndResolve(pAST.object);

    if (!tResolved.isSet && !tResolved.isRequired) {
      if (pAST.object.type === 'Identifier') {
        this.assign(pAST.object.name, tResolved);
      }

      tResolved.require();
    }

    if (pAST.computed) {
      tProperty = this.handleAndResolve(pAST.property);

      if (!tProperty.isSet) {
        if (!tProperty.isRequired) {
          tProperty.require();
        }

        return this.vm.UNDEFINED();
      }

      tName = tProperty.value + '';
    } else {
      if (pAST.property.type === 'Identifier') {
        tName = pAST.property.name;
      } else {
        tName = this.handleAndResolve(pAST.property).value + '';
      }
    }

    if (tResolved.value === void 0 || tResolved.value === null) {
      this.vm.log('Attempt to get ' + tName + ' of non value. Returning UNDEFINED');

      return this.vm.UNDEFINED();
    }

    try {
      if (!tResolved.value[tName]) {
        if (!tResolved.proto) {
          tResolved = tResolved.value[tName] = this.vm.UNDEFINED();
        } else {
          tResolved = tResolved.value[tName] = resolveInPrototypeChain(tResolved.proto, tName);
        }
      } else if (!tResolved.value[tName].isSet) {
        tResolved = this.vm.createValue(tResolved.value[tName].value);
      } else {
        tResolved = tResolved.value[tName];
      }
    } catch (e) {
      this.vm.log('Error thrown in MemberExpression: ' + e.toString());
    }

    return tResolved;
  };

  p.Identifier = function(pAST) {
    return this.vm.createValue(pAST.name, false);
  };

  p.ThisExpression = function(pAST) {
    return this.thisMember;
  };

  p.Literal = function(pAST) {
    return this.vm.createValue(pAST.value, true, true);
  };

  p.ObjectExpression = function(pAST) {
    var tResolved = {};
    var i, il;

    for (i = 0, il = pAST.properties.length; i < il; i++) {
      tResolved[this.handle(pAST.properties[i].key).value] = this.handleAndResolve(pAST.properties[i].value);
    }

    return this.vm.createValue(tResolved, true, true);
  };

  p.ArrayExpression = function(pAST) {
    var tArray = [];
    var i, il;

    for (i = 0, il = pAST.elements.length; i < il; i++) {
      tArray[i] = this.handleAndResolve(pAST.elements[i]);
    }

    return this.vm.createValue(tArray, true, true);
  };

  p.IfStatement = function(pAST) {
    var tResolved;

    this.handle(pAST.test);

    this.handle(pAST.consequent);

    if (pAST.alternate) {
      this.handle(pAST.alternate);
    }
  };

  p.ForInStatement = function(pAST) {
    var tLeft = this.handleAndResolve(pAST.left);
    var tResolved = this.handleAndResolve(pAST.right);

    if (!tResolved.isSet && !tResolved.isRequired) {
      tResolved.require();

      return;
    }

    for (var k in tResolved.value) {
      tLeft.set(k);

      this.handle(pAST.body);
    }
  };

  p.ReturnStatement = function(pAST) {
    if (pAST.argument === null) {
      this.returnValue = this.vm.UNDEFINED();
    } else {
      this.returnValue = this.handleAndResolve(pAST.argument);
    }
  };

  function createFunction(pVM, pScope, pId, pParams, pBody) {
    var tFunction = pVM.createValue(function(pScope) {
      var tResolved;
      var tArguments;
      var tLength;
      var i, il;

      if (pId) {
        pScope.assign(pId, tFunction);
      }

      tResolved = pScope.resolve('arguments');

      if (tResolved && pParams) {
        tArguments = tResolved.value;
        tLength = tArguments.length;

        for (i = 0, il = pParams.length; i < il; i++) {
          if (i < tLength) {
            pScope.assign(pParams[i].name, tArguments[i]);
          } else {
            pScope.assign(pParams[i].name, pScope.vm.createValue(void 0));
          }
        }
      }

      pScope.ast = [];
      pScope.addAST(pBody);
      pScope.interpret();

      return pScope.returnValue;
    });

    tFunction.scope = pScope;

    tFunction.value.prototype = pVM.createValue({});

    return tFunction;
  }

  function Value(pVM, pValue, pIsSet, pIsLiteral) {
    this.vm = pVM;
    this.value = pValue;
    this.proto = null;
    this.isLiteral = typeof pIsLiteral !== 'boolean' ? false : pIsLiteral;
    this.isSet = typeof pIsSet !== 'boolean' ? true : pIsSet;
    this.isRequired = false;
    this.isNative = pVM.nativeMode;
  }

  Value.prototype.require = function() {
    this.isRequired = true;
    this.value = {};
  };

  Value.prototype.set = function(pValue) {
    this.value = pValue;
    this.isSet = true;
  };

  Value.prototype.copy = function(pValue) {
    this.value = pValue.value;
    this.proto = pValue.proto;
    this.isLiteral = pValue.isLiteral;
    this.isSet = pValue.isSet;
    this.isRequired = pValue.isRequired;
    this.isNative = pValue.isNative;

    if ('scope' in pValue) {
      this.scope = pValue.scope;
    } else if ('scope' in this) {
      delete this.scope;
    }
  };

  Value.prototype.newCopy = function() {
    var tValue = this.vm.createValue();

    for (var k in this) {
      tValue[k] = this[k]
    }

    return tValue;
  }

  var mCache = [];

  tProto.safePrint = function(pObject) {
    this.log(JSON.stringify(pObject, function(pKey, pValue) {
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
b.a.c = {};

(function(global) {
  function Animal(pName) {
    this.name = pName;
    this.position = 0;
    rejs.log(this.name);
  }

  var tProto = Animal.prototype

  tProto.run = function(pDistance) {
    this.position += pDistance;
  }

  /**
   * @class
   * @extends {Animal}
   */
  var Dog = (function(pSuper) {
    /**
     * @constructor
     */
    function Dog() {
      pSuper.call(this, 'dog');
      this.hasTail = true;
    }
  
    var tProto = Dog.prototype = Object.create(pSuper.prototype);
    tProto.constructor = Dog;

    return Dog;
  })(Animal);

  /**
   * @class
   * @extends {Dog}
   */
  var FastDog = (function(pSuper) {
    /**
     * @constructor
     */
    function FastDog() {
      pSuper.call(this);
    }

    var tProto = FastDog.prototype = Object.create(pSuper.prototype);
    tProto.constructor = FastDog;
  
    tProto.run = function(pDistance) {
      pSuper.prototype.run.call(this, pDistance * 2);
    };

    return FastDog;
  })(Dog);

  global.Animal = Animal;
  global.Dog = Dog;
  global.FastDog = FastDog;
}(this));

(function() {
  var tDog = new FastDog();
  tDog.run(234);
}());

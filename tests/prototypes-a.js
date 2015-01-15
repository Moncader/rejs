var Dog;

(function() {

  /**
   * @class
   * @extends {Animal}
   */
  Dog = (function(pSuper) {
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

}());
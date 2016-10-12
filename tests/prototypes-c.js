var FastDog;

(function() {

  /**
   * @class
   * @extends {Dog}
   */
  FastDog = (function(pSuper) {
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

}());
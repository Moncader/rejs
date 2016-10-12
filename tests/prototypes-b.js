var Animal;

(function() {
  Animal = function(pName) {
    this.name = pName;
    this.position = 0;
  }

  var tProto = Animal.prototype;

  tProto.run = function(pDistance) {
    this.position += pDistance;
  }
}());

module.exports = function(context) {
  function isNotHungarian(name) {
    return name.charAt(0).match(/[a-z]/) === null || name.charAt(1).match(/[A-Z]/) === null;
  }

  function report(node) {
    context.report(node, "Identifier '{{name}}' is not in hungarian notation.", { name: node.name });
  }

  return {
    "Identifier": function(node) {
      if (node.parent.type === "FunctionDeclaration"
        && node.parent.id.name !== node.name) {
        if (isNotHungarian(node.name)) {
          report(node);
        }
      }
    }
  };
};

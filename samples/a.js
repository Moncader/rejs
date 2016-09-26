var a = b.a = {};

if (a) {
  console.log('got a!');
} else if (b) {
  console.log('got b!');
} else {
  console.log('got nothing!');
}

for (var k in b) {
  console.log(k);
}

var tArray = [1, 2, 3];

for (var i = 0, il = tArray.length; i < il; i++) {
  console.log(tArray[i]);
}
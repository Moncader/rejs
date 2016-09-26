var b = {};

function test(pA, pB) {
  return pA <<= pB * pA;
}

b[test(3, 2)] = true;

b[typeof 'stringtype'] = void 0;

b[!{}] = true;

var counter = 100;

b[--counter] = true;
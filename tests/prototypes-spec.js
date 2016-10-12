describe('Prototypes', function() {
  it('should allow the prototype chain to work', function() {
    expect(rejsResolve([
      'prototypes-a.js',
      'prototypes-b.js',
      'prototypes-c.js'
    ])).toEqual([
      'prototypes-b.js',
      'prototypes-a.js',
      'prototypes-c.js'
    ]);
  });
});
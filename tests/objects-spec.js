describe('Global namespace objects', function() {
  it('should hold child objects and should be after the files that hold the parent objects.', function() {
    expect(rejsResolve([
      'objects-a.js',
      'objects-b.js',
      'objects-c.js'
    ])).toEqual([
      'objects-b.js',
      'objects-a.js',
      'objects-c.js'
    ]);
  });
});
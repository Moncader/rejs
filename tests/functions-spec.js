describe('Functions', function() {
  it('should resolve deep dependencies across files.', function() {
    expect(rejsResolve([
      'functions-c.js',
      'functions-b.js',
      'functions-a.js'
    ])).toEqual([
      'functions-c.js',
      'functions-a.js',
      'functions-b.js'
    ]);
  });
});
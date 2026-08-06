module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    import: ['features/support/**/*.js'],
    format: ['progress'],
    // Trunk-based: scenarier som väntar på implementation taggas @wip och
    // räknas inte som röda på main. Kör dem lokalt med: npx cucumber-js -t @wip
    tags: 'not @wip',
  },
};

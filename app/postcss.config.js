// Keep CSS processing self-contained. Without a project-local config, Next may walk above the checkout
// and load an unrelated user-level PostCSS configuration.
module.exports = {
  plugins: {},
};

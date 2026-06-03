// Tailwind CSS v4 ships its PostCSS plugin as a separate package and handles
// vendor prefixing internally (Lightning CSS), so autoprefixer is no longer needed.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {}
  }
}

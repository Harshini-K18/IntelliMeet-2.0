/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}", // Include all your source files
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        "light-bg": "#f9f9f9",
        "dark-bg": "#1a202c",
      },
    },
  },
  plugins: [],
};


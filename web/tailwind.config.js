/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        deepseek: {
          50: "rgb(237, 243, 254)",
          100: "rgb(228, 237, 253)",
          200: "rgb(211, 226, 255)",
          300: "rgb(183, 200, 254)",
          400: "rgb(122, 170, 255)",
          450: "rgb(86, 134, 254)",
          500: "rgb(65, 118, 230)",
          600: "rgb(72, 104, 178)",
          800: "rgb(52, 65, 91)",
          900: "rgb(40, 49, 66)",
        },
        surface: {
          base: "#0f1115",
          panel: "#151517",
          card: "#1b1b1c",
          hover: "#232326",
        },
        border: {
          base: "#2c2c2e",
          subtle: "rgba(255, 255, 255, 0.08)",
        },
        dsw: {
          deepseek: {
            400: "var(--dsw-static-deepseek-400, rgb(122, 170, 255))",
            500: "var(--dsw-static-deepseek-500, rgb(65, 118, 230))",
            600: "var(--dsw-static-deepseek-600, rgb(72, 104, 178))",
          },
          neutral: {
            bluish: {
              750: "rgb(67, 69, 74)",
              800: "rgb(53, 54, 56)",
              850: "rgb(44, 44, 46)",
              900: "rgb(27, 27, 28)",
              950: "rgb(21, 21, 23)",
              1000: "rgb(15, 17, 21)",
            },
          },
          green: {
            400: "rgb(78, 209, 126)",
            500: "rgb(34, 197, 94)",
            900: "rgb(35, 60, 44)",
          },
          red: {
            400: "rgb(242, 90, 90)",
            500: "rgb(239, 68, 68)",
            600: "rgb(236, 19, 19)",
          },
        },
      },
      borderColor: {
        base: "#2c2c2e",
        subtle: "rgba(255, 255, 255, 0.08)",
      },
    },
  },
  plugins: [],
};

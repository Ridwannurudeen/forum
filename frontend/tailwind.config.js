module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        forum: {
          bg: "#0a0a0f",
          panel: "#11131b",
          panel2: "#171a26",
          panel3: "#1e2230",
          ink: "#ece9f3",
          dim: "#9aa0b4",
          dim2: "#6f7b86",
          accent: "#9b8cf5",
          accent2: "#9bb8ff",
          accent3: "#e6b455",
          line: "rgba(180,184,215,0.13)",
          line2: "rgba(180,184,215,0.07)",
          ok: "#54cf9e",
          warn: "#e6b455",
          err: "#ff6b7a",
        },
      },
      maxWidth: {
        "8xl": "88rem",
      },
    },
  },
};

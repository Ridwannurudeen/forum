module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Aptos",
          "Segoe UI Variable",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Aptos Display",
          "Segoe UI Variable Display",
          "Aptos",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "Cascadia Mono",
          "Berkeley Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        forum: {
          bg: "#070a0d",
          panel: "#0d1217",
          panel2: "#111922",
          panel3: "#17212b",
          ink: "#f4f1ea",
          dim: "#a8b3bd",
          dim2: "#6f7b86",
          accent: "#4cf0c2",
          accent2: "#9bb8ff",
          accent3: "#f6c76b",
          line: "rgba(180,201,215,0.13)",
          line2: "rgba(180,201,215,0.07)",
          ok: "#4cf0c2",
          warn: "#f6c76b",
          err: "#ff6b7a",
        },
      },
      maxWidth: {
        "8xl": "88rem",
      },
    },
  },
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      // 自定义色板：苔绿 / 米白 / 琥珀。不用 Tailwind 默认色。
      colors: {
        ink: { DEFAULT: '#10160f', soft: '#1a231a', line: 'rgba(243,239,227,0.14)' },
        moss: { 900: '#1e3327', 700: '#2f4f3e', 500: '#3f6b52', 300: '#7fa588' },
        sage: '#8fa88e',
        cream: { DEFAULT: '#f3efe3', dim: 'rgba(243,239,227,0.65)' },
        amber: { DEFAULT: '#c97b3c', soft: '#e0a468' },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: { xl2: '18px' },
      keyframes: {
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-7px)' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        fadeUp: 'fadeUp .5s cubic-bezier(.34,1.56,.64,1) both',
      },
    },
  },
  plugins: [],
};

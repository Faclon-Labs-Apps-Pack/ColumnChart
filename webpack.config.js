import path from 'path';
import { fileURLToPath } from 'url';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPONENTS = {
  ColumnChart: './src/components/ColumnChart/index.ts',
  ColumnChartConfiguration: './src/components/ColumnChartConfiguration/index.ts',
};

export default (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: isProd ? COMPONENTS : { app: './src/index.tsx' },
    output: {
      path: path.resolve(__dirname, isProd ? 'dist-bundle' : 'dist'),
      filename: isProd ? '[name].bundle.js' : '[name].js',
      globalObject: 'this',
      clean: true,
    },
    externals: isProd
      ? {
          // These are NOT bundled — the host (I/O-Lens / Angular shell) must
          // expose them as globals on `window` BEFORE the widget bundle runs:
          //   window.React, window.ReactDOM, window.ReactJSXRuntime,
          //   window.ReactDOMServer, window.Highcharts
          // If `window.Highcharts` is missing, the design-sdk chart code reads
          // `Highcharts.AST` on undefined → "Cannot read properties of
          // undefined (reading 'AST')". The Highcharts version must be v12.x to
          // match @faclon-labs/design-sdk. The exporting/export-data modules are
          // bundled with the widget and self-attach to window.Highcharts.
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-dom/client': 'ReactDOM',
          'react-dom/server': 'ReactDOMServer',
          'react/jsx-runtime': 'ReactJSXRuntime',
          'react/jsx-dev-runtime': 'ReactJSXRuntime',
          highcharts: 'Highcharts',
          apexcharts: 'ApexCharts',
        }
      : {},
    // Safety net: if any code path imports the ESM Highcharts entry, route it to
    // the same bare `highcharts` specifier so it resolves to the single external
    // global instead of bundling a second, separate Highcharts instance.
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: isProd
        ? {
            'highcharts/esm/highcharts.js': 'highcharts',
            'highcharts/esm/highcharts': 'highcharts',
          }
        : {},
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          include: /node_modules/,
          resolve: { fullySpecified: false },
        },
        {
          test: /\.(ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: [
            isProd ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
          ],
        },
        {
          test: /\.(png|jpg|jpeg|gif|webp|svg)$/i,
          type: 'asset/resource',
          generator: { filename: 'assets/[name][ext]' },
        },
      ],
    },
    plugins: [
      ...(isProd ? [new MiniCssExtractPlugin({ filename: '[name].bundle.css' })] : []),
    ],
    ...(!isProd && {
      devServer: {
        static: path.resolve(__dirname, 'public'),
        host: '0.0.0.0',
        port: 3003,
        hot: true,
        open: false,
        historyApiFallback: true,
        allowedHosts: 'all',
      },
    }),
  };
};

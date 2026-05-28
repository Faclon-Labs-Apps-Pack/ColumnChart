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
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
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
        port: 3003,
        hot: true,
        open: false,
        historyApiFallback: true,
      },
    }),
  };
};

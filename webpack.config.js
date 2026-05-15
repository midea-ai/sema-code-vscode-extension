//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');

/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode',
    '@vscode/ripgrep': 'commonjs @vscode/ripgrep'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  node: {
    // 保持 Node.js 环境的全局变量
    __dirname: false,
    __filename: false
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [
          /node_modules/,
          /\.tsx$/
        ],
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.json'
            }
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

/** @type WebpackConfig */
const chatWebviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/chat/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'chat.js'
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    fallback: {
      "process": false,
      "buffer": false
    }
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({})
    })
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

/** @type WebpackConfig */
const configWebviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/config/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'config.js'
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    fallback: {
      "process": false,
      "buffer": false
    }
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({})
    })
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

/** @type WebpackConfig */
const sessionHistoryWebviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/sessionHistory/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'sessionHistory.js'
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    fallback: {
      "process": false,
      "buffer": false
    }
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({})
    })
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log"
  }
};

module.exports = [extensionConfig, chatWebviewConfig, configWebviewConfig, sessionHistoryWebviewConfig];
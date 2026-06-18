//@ts-check
'use strict';

const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

// 从已安装的 sema-core 读取真实版本，避免在界面中硬编码
// 直接读文件而非 require：sema-core 的 exports 未导出 ./package.json
const semaCoreVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'node_modules/sema-core/package.json'), 'utf8')
).version;

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
    extensions: ['.ts', '.js'],
    // Node16 TS requires `.js` on dynamic import() specifiers (claw lazy chunk);
    // map them back to the .ts sources on disk.
    extensionAlias: {
      '.js': ['.ts', '.js']
    }
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
      },
      {
        test: /\.(woff2?|ttf|eot)$/,
        type: 'asset/inline'
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({}),
      '__SEMA_CORE_VERSION__': JSON.stringify(semaCoreVersion)
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
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

// JB 插件用的聊天 bundle：与 chat 相同配置，仅换入口/产物名。
// 入口 jb-index.tsx 额外打包了 semaSessionWrapper + RemoteSession 代理（走 gRPC）。
const chatWebviewJbConfig = {
  ...chatWebviewConfig,
  entry: './src/webview/chat/jb-index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'jb-chat.js'
  },
  resolve: {
    ...chatWebviewConfig.resolve,
    alias: {
      ...(chatWebviewConfig.resolve.alias || {}),
      // 只把 semaSessionWrapper 需要的常量留下，避免 sema-core 的 node 依赖进入 web 包
      'sema-core/types$': path.resolve(__dirname, 'src/webview/chat/jb/sema-core-types-stub.ts')
    }
  }
};

// JB 插件用的配置页 bundle：与 config 相同配置，仅换入口/产物名。
// 入口 jb-index.tsx 用 config-bridge 提供 vscode shim（走 gRPC + Kotlin systemConfig channel）。
const configWebviewJbConfig = {
  ...configWebviewConfig,
  entry: './src/webview/config/jb-index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'jb-config.js'
  }
};

// JB 插件用的历史会话 bundle：与 sessionHistory 相同配置，仅换入口/产物名。
// 入口 jb-index.tsx 用 history-bridge 提供 vscode shim（走 Kotlin 本地会话历史存储）。
const sessionHistoryWebviewJbConfig = {
  ...sessionHistoryWebviewConfig,
  entry: './src/webview/sessionHistory/jb-index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'jb-sessionHistory.js'
  }
};

/**
 * 可视化页内 runtime（src/webview/viz-runtime/main.ts）：宿主把它注入到可视化 html（VSCode 内联源码走 srcdoc，JB <script src> 引临时副本），
 * 在内联 iframe（不透明源）里跑，必须是 classic 脚本、单文件 IIFE，不与主应用共享代码。VSCode / JB 共用同一产物。
 * @type WebpackConfig
 */
const vizRuntimeConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/viz-runtime/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist/webview'),
    filename: 'viz-runtime.js',
    iife: true
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      }
    ]
  },
  devtool: false,
  infrastructureLogging: {
    level: "log"
  }
};

module.exports = [extensionConfig, chatWebviewConfig, configWebviewConfig, sessionHistoryWebviewConfig, chatWebviewJbConfig, configWebviewJbConfig, sessionHistoryWebviewJbConfig, vizRuntimeConfig];
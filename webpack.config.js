import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import HtmlWebpackPlugin from "html-webpack-plugin";
import CleanWebpackPlugin from "clean-webpack-plugin";
import CopyWebpackPlugin from 'copy-webpack-plugin';
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import HtmlWebpackInlineSVGPlugin from 'html-webpack-inline-svg-plugin';

const outputDirectory = "dist";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

export default (env, argv) => {
    const devMode = argv.mode !== "production";
    return {
        entry: "./src/client/index.js",
        devtool: "source-map",
        experiments: {
            outputModule: true
        },
        output: {
            path: join(__dirname, outputDirectory),
            filename: "bundle.js",
            module: true,
            chunkFormat: "module",
        },
        target: "web",
        module: {
            rules: [
                {
                    test: /\.mjs/,
                    use: {
                        loader: "babel-loader",
                        options: {
                            plugins: [
                                "@babel/plugin-proposal-class-properties"
                            ]
                        }
                    }
                },
                {
                    test: /\.css$/,
                    use: [devMode ? "style-loader" : MiniCssExtractPlugin.loader, "css-loader"]
                },
                {
                    test: /\.scss$/,
                    use: [devMode ? "style-loader" : MiniCssExtractPlugin.loader, "css-loader", {loader: 'sass-loader', options: {sassOptions: {quietDeps: true}}}]
                },
                {
                    test: /\.(png|woff|woff2|eot|ttf|svg)$/,
                    type: 'asset'
                },
                {
                    test: require.resolve('jquery'),
                    loader: 'expose-loader',
                    options: {
                        exposes: ['$']
                    }
                },
                {
                    test: /\.svg$/,
                    type: "asset/inline",
                    // Inline assets with the "inline" query parameter.
                    resourceQuery: /inline/,
                },
            ]
        },
        devServer: {
            port: 3000,
            open: true,
            proxy: {
                "/api": "http://localhost:8080"
            }
        },
        plugins: [
            new CleanWebpackPlugin(),
            new HtmlWebpackPlugin({
                template: "./public/index.html",
                inject: 'head',
                scriptLoading: 'module'
    //            favicon: "./public/favicon.ico"
            }),
            new HtmlWebpackInlineSVGPlugin(),
            new CopyWebpackPlugin({
                patterns: [
                    { from: 'public/*.+(ico|png|svg|webmanifest|js|wasm)', to: '[name][ext]' },
                    { from: 'node_modules/yosys2digitaljs/tests/*.sv', to: 'examples/[name][ext]' }
                ]
            })
        ].concat(devMode ? [] : [new MiniCssExtractPlugin()]),
        optimization: {
            splitChunks: false,
            runtimeChunk: false,
        }
    };
};


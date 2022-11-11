const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackInlineSVGPlugin = require('html-webpack-inline-svg-plugin');

const outputDirectory = "dist";

module.exports = (env, argv) => {
    const devMode = argv.mode !== "production";
    return {
        entry: "./src/client/index.js",
        devtool: "source-map",
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "bundle.js"
        },
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
                    use: [devMode ? "style-loader" : MiniCssExtractPlugin.loader, "css-loader", "sass-loader"]
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
                inject: 'head'
    //            favicon: "./public/favicon.ico"
            }),
            new HtmlWebpackInlineSVGPlugin(),
            new CopyWebpackPlugin({
                patterns: [
                    { from: 'public/*.+(ico|png|svg|webmanifest)', to: '[name][ext]' },
                    { from: 'node_modules/yosys2digitaljs/tests/*.sv', to: 'examples/[name][ext]' }
                ]
            })
        ].concat(devMode ? [] : [new MiniCssExtractPlugin()]),
    };
};


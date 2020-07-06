const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const CopyWebpackPlugin = require('copy-webpack-plugin');

const outputDirectory = "dist";

module.exports = {
    entry: "./src/client/index.js",
    devtool: "source-map",
    output: {
        path: path.join(__dirname, outputDirectory),
        filename: "bundle.js"
    },
    module: {
        rules: [
            { // workaround for Webpack borkedness
                test: /\.mjs/,
                type: "javascript/auto",
                use: {
                    loader: "babel-loader",
                    options: {
                        plugins: ["@babel/plugin-proposal-class-properties"]
                    }
                }
            },
        /*
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: "babel-loader"
                }
            },
            */
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"]
            },
            {
                test: /\.scss$/,
                use: ["style-loader", "css-loader", "sass-loader"]
            },
            {
                test: /\.(png|woff|woff2|eot|ttf|svg)$/,
                loader: "url-loader?limit=100000"
            },
            {
                test: require.resolve('jquery'),                                
                use: [{                                                         
                    loader: 'expose-loader',                                    
                    options: '$'                                                
                }]
            }
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
        new CopyWebpackPlugin([
                { from: 'public/*.+(ico|png|svg|webmanifest)', to: '', flatten: true },
                { from: 'node_modules/yosys2digitaljs/tests/*.sv', to: 'examples', flatten: true }
        ])
    ]
};

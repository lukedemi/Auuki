module.exports = {
    "setupFiles": [
        "<rootDir>/test/jest-setup.js"
    ],
    "transform": {
        // workers/group is its own package, so its .babelrc is only read
        // when babel is told to look there
        "^.+\\.js$": ["babel-jest", {"babelrcRoots": [".", "workers/*"]}]
    },
    "testPathIgnorePatterns": ["/node_modules/", "/workers/group/node_modules/"],
};

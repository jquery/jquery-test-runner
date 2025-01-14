export default {
  extends: [ "@commitlint/config-conventional" ],
  rules: {
    "subject-case": [ 2, "never", [ "upper-case" ] ],
    "scope-case": [
      2,
      "always",
      [ "lower-case", "camel-case", "kebab-case", "pascal-case" ]
    ]
  }
};

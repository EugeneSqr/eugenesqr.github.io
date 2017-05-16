System.register("node_modules/systemjs-plugin-babel/babel-helpers/classCallCheck.js", [], function (_export, _context) {
  "use strict";

  return {
    setters: [],
    execute: function () {
      _export("default", function (instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError("Cannot call a class as a function");
        }
      });
    }
  };
});
System.register("node_modules/systemjs-plugin-babel/babel-helpers/createClass.js", [], function (_export, _context) {
  "use strict";

  return {
    setters: [],
    execute: function () {
      _export("default", function () {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ("value" in descriptor) descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
          }
        }

        return function (Constructor, protoProps, staticProps) {
          if (protoProps) defineProperties(Constructor.prototype, protoProps);
          if (staticProps) defineProperties(Constructor, staticProps);
          return Constructor;
        };
      }());
    }
  };
});
System.register("source/view/js/resource.js", [], function (_export, _context) {
    "use strict";

    /**
     * Get resource by specified url. Returns a promise.
     */
    function getAsync(url) {
        return new Promise(function (resolve, reject) {
            var request = new XMLHttpRequest();
            request.open("GET", url);

            request.onload = function () {
                if (request.status >= 200 && request.status < 400) {
                    resolve(JSON.parse(request.responseText));
                } else {
                    reject("error code: " + request.status);
                }
            };

            request.onerror = function (error) {
                reject(error);
            };

            request.send();
        });
    }

    return {
        setters: [],
        execute: function () {
            _export("getAsync", getAsync);
        }
    };
});
System.register("source/view/js/assert.js", [], function (_export, _context) {
    "use strict";

    /**
     * Asserts that candidate is array
     */
    function assertArray(candidate, clarification) {
        assert(Array.isArray(candidate), clarification, "not an array");
    }

    /**
     * Asserts object not empty
     */
    function assertObject(candidate, clarification) {
        assert(typeof candidate === "object" && candidate !== null, clarification, "object is empty");
    }function assert(condition, message, fallbackMessage) {
        if (!condition) {
            var errorMessage = "Assert failed";
            if (typeof message !== "undefined") {
                errorMessage += ": " + message;
            } else if (typeof fallbackMessage !== "undefined") {
                errorMessage += ": " + fallbackMessage;
            }

            throw new Error(errorMessage);
        }
    }return {
        setters: [],
        execute: function () {
            _export("assertArray", assertArray);

            _export("assertObject", assertObject);
        }
    };
});
System.register("source/view/js/postViewModel.js", ["node_modules/systemjs-plugin-babel/babel-helpers/classCallCheck.js", "node_modules/systemjs-plugin-babel/babel-helpers/createClass.js", "./resource.js", "./assert.js", "put-selector"], function (_export, _context) {
    "use strict";

    var _classCallCheck, _createClass, getAsync, assertArray, assertObject, put, PostViewModel;

    return {
        setters: [function (_node_modulesSystemjsPluginBabelBabelHelpersClassCallCheckJs) {
            _classCallCheck = _node_modulesSystemjsPluginBabelBabelHelpersClassCallCheckJs.default;
        }, function (_node_modulesSystemjsPluginBabelBabelHelpersCreateClassJs) {
            _createClass = _node_modulesSystemjsPluginBabelBabelHelpersCreateClassJs.default;
        }, function (_resourceJs) {
            getAsync = _resourceJs.getAsync;
        }, function (_assertJs) {
            assertArray = _assertJs.assertArray;
            assertObject = _assertJs.assertObject;
        }, function (_putSelector) {
            put = _putSelector.default;
        }],
        execute: function () {
            _export("PostViewModel", PostViewModel = function () {
                function PostViewModel() {
                    _classCallCheck(this, PostViewModel);
                }

                _createClass(PostViewModel, [{
                    key: "inflate",
                    value: function inflate() {
                        getAsync("post-headers.json").then(function (posts) {
                            assertArray(posts, "posts headers must be an array");
                            posts.forEach(function (post) {
                                var sidebarListElement = document.getElementById("sidebar-list");
                                assertObject(sidebarListElement, "sidebar list element does not exist");

                                var sidebarPostElement = put(sidebarListElement, "li");
                                put(sidebarPostElement, "span", post.dateCreated + " ");
                                put(sidebarPostElement, "a[href='" + post.url + "']", post.title);
                            });
                        }, function (error) {
                            console.log("error getting model", error);
                        });
                    }
                }]);

                return PostViewModel;
            }());

            _export("PostViewModel", PostViewModel);
        }
    };
});
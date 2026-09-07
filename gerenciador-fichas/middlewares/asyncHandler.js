function asyncHandler(controllerFn) {
  return (req, res, next) => {
    controllerFn({ req, res }).catch(next);
  };
}

module.exports = asyncHandler;

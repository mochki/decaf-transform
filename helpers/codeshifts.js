// div -> React.DOM.div
// https://github.com/keboola/kbc-ui-codemod/blob/88be9ea31cd58cae5759806904537531bd86d470/transforms/dom-factories-calls-to-calls-with-react-dom-prefix.js
// Remove `const {div, span, ...} = React.DOM`
// credit: Justin Waite
// Remove render({div, span, ...})
// credit: Justin Waite
// React.DOM.div -> React.createElement('div', ...)
// https://github.com/reactjs/react-codemod/blob/master/transforms/React-DOM-to-react-dom-factories.js
// createElement -> JSX
// https://github.com/reactjs/react-codemod/blob/master/transforms/create-element-to-jsx.js

const {domFactories} = require('./constants')

module.exports = function transformer(file, api) {
  const j = api.jscodeshift
  // const ReactUtils = require('./ReactUtils')(j)
  const DOMModuleName = 'DOM'
  const isDomFactory = name => domFactories.hasOwnProperty(name)
  const isReactDOMIdentifier = path =>
    path.node.name === DOMModuleName &&
    (path.parent.node.type === 'MemberExpression' && path.parent.node.object.name === 'React')

  //
  // div -> React.DOM.div
  const prefixDOMCalls = j(file.source)
    .find(j.Identifier)
    .filter(path => path.name === 'callee' && isDomFactory(path.node.name))
    .forEach(path => j(path).replaceWith(j.identifier('React.DOM.' + path.node.name)))
    .toSource()

  //
  // Remove render({div, span, ...})
  const removeDestructuredInRender = j(prefixDOMCalls)
    .find(j.Property, path => path.key.name === 'render')
    .forEach(renderFn => removeParamsFromRender({j, path: renderFn}))
    .toSource()

  //
  // Remove `const {div, span, ...} = React.DOM`
  const removedDestructuredDOM = j(removeDestructuredInRender)
    .find(j.Property, path => path.key.name === 'render' || (path.key.name && path.key.name.startsWith('_render')))
    .forEach(renderFn => removeDomDestructuresFromFunction({j, path: renderFn}))
    .toSource()

  //
  // React.DOM.div -> React.createElement('div', ...)
  const toCreateElement = j(removedDestructuredDOM)
    .find(j.Identifier)
    .filter(isReactDOMIdentifier)
    .forEach(path => {
      const DOMargs = path.parent.parent.parent.node.arguments
      const DOMFactoryPath = path.parent.parent.node.property
      if (!DOMargs || !DOMFactoryPath) return // For funky cases where React.DOM is still destructured
      const DOMFactoryType = DOMFactoryPath.name

      path.parent.parent.node.property = j.identifier('createElement')
      j(path.parent).replaceWith(j.identifier('React'))
      DOMargs.unshift(j.literal(DOMFactoryType))
    })
    .toSource()

  //
  //
  //
  // It's going to be messy from here on out
  // Straight from React
  const encodeJSXTextValue = value => value.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const canLiteralBePropString = node => node.raw.indexOf('\\') === -1 && node.value.indexOf('"') === -1

  const convertExpressionToJSXAttributes = expression => {
    if (!expression) {
      return {
        attributes: [],
        extraComments: []
      }
    }

    const isReactSpread =
      expression.type === 'CallExpression' &&
      expression.callee.type === 'MemberExpression' &&
      expression.callee.object.name === 'React' &&
      expression.callee.property.name === '__spread'

    const isObjectAssign =
      expression.type === 'CallExpression' &&
      expression.callee.type === 'MemberExpression' &&
      expression.callee.object.name === 'Object' &&
      expression.callee.property.name === 'assign'

    const validSpreadTypes = ['Identifier', 'MemberExpression', 'CallExpression']

    if (isReactSpread || isObjectAssign) {
      const resultAttributes = []
      const resultExtraComments = expression.comments || []
      const {callee} = expression
      for (const node of [callee, callee.object, callee.property]) {
        resultExtraComments.push(...(node.comments || []))
      }
      expression.arguments.forEach(expression => {
        const {attributes, extraComments} = convertExpressionToJSXAttributes(expression)
        resultAttributes.push(...attributes)
        resultExtraComments.push(...extraComments)
      })

      return {
        attributes: resultAttributes,
        extraComments: resultExtraComments
      }
    } else if (validSpreadTypes.indexOf(expression.type) != -1) {
      return {
        attributes: [j.jsxSpreadAttribute(expression)],
        extraComments: []
      }
    } else if (expression.type === 'ObjectExpression') {
      const attributes = expression.properties.map(property => {
        if (property.type === 'SpreadProperty') {
          const spreadAttribute = j.jsxSpreadAttribute(property.argument)
          spreadAttribute.comments = property.comments
          return spreadAttribute
        } else if (property.type === 'Property') {
          const propertyValueType = property.value.type

          let value
          if (
            propertyValueType === 'Literal' &&
            typeof property.value.value === 'string' &&
            canLiteralBePropString(property.value)
          ) {
            value = j.literal(property.value.value)
            value.comments = property.value.comments
          } else {
            value = j.jsxExpressionContainer(property.value)
          }

          let jsxIdentifier
          if (property.key.type === 'Literal') {
            jsxIdentifier = j.jsxIdentifier(property.key.value)
          } else {
            jsxIdentifier = j.jsxIdentifier(property.key.name)
          }
          jsxIdentifier.comments = property.key.comments

          const jsxAttribute = j.jsxAttribute(jsxIdentifier, value)
          jsxAttribute.comments = property.comments
          return jsxAttribute
        }
        return null
      })

      return {
        attributes,
        extraComments: expression.comments || []
      }
    } else if (expression.type === 'Literal' && expression.value === null) {
      return {
        attributes: [],
        extraComments: expression.comments || []
      }
    } else {
      throw new Error(`Unexpected attribute of type "${expression.type}"`)
    }
  }

  const canConvertToJSXIdentifier = node =>
    (node.type === 'Literal' && typeof node.value === 'string') ||
    node.type === 'Identifier' ||
    (node.type === 'MemberExpression' &&
      !node.computed &&
      canConvertToJSXIdentifier(node.object) &&
      canConvertToJSXIdentifier(node.property))

  const jsxIdentifierFor = node => {
    let identifier
    let comments = node.comments || []
    if (node.type === 'Literal') {
      identifier = j.jsxIdentifier(node.value)
    } else if (node.type === 'MemberExpression') {
      let {identifier: objectIdentifier, comments: objectComments} = jsxIdentifierFor(node.object)
      let {identifier: propertyIdentifier, comments: propertyComments} = jsxIdentifierFor(node.property)
      identifier = j.jsxMemberExpression(objectIdentifier, propertyIdentifier)
      comments.push(...objectComments, ...propertyComments)
    } else {
      identifier = j.jsxIdentifier(node.name)
    }
    return {comments, identifier}
  }

  const isCapitalizationInvalid = node =>
    (node.type === 'Literal' && !/^[a-z]/.test(node.value)) || (node.type === 'Identifier' && /^[a-z]/.test(node.name))

  const convertNodeToJSX = node => {
    const comments = node.value.comments || []
    const {callee} = node.value
    for (const calleeNode of [callee, callee.object, callee.property]) {
      for (const comment of calleeNode.comments || []) {
        comment.leading = true
        comment.trailing = false
        comments.push(comment)
      }
    }

    const args = node.value.arguments

    if (isCapitalizationInvalid(args[0]) || !canConvertToJSXIdentifier(args[0])) {
      return node.value
    }

    const {identifier: jsxIdentifier, comments: identifierComments} = jsxIdentifierFor(args[0])
    const props = args[1]

    const {attributes, extraComments} = convertExpressionToJSXAttributes(props)

    for (const comment of [...identifierComments, ...extraComments]) {
      comment.leading = false
      comment.trailing = true
      comments.push(comment)
    }

    const children = args.slice(2).map((child, index) => {
      if (
        child.type === 'Literal' &&
        typeof child.value === 'string' &&
        !child.comments &&
        child.value !== '' &&
        child.value.trim() === child.value
      ) {
        return j.jsxText(encodeJSXTextValue(child.value))
      } else if (
        child.type === 'CallExpression' &&
        child.callee.object &&
        child.callee.object.name === 'React' &&
        child.callee.property.name === 'createElement'
      ) {
        const jsxChild = convertNodeToJSX(node.get('arguments', index + 2))
        if (jsxChild.type !== 'JSXElement' || (jsxChild.comments || []).length > 0) {
          return j.jsxExpressionContainer(jsxChild)
        } else {
          return jsxChild
        }
      } else if (child.type === 'SpreadElement') {
        return j.jsxExpressionContainer(child.argument)
      } else {
        return j.jsxExpressionContainer(child)
      }
    })

    const openingElement = j.jsxOpeningElement(jsxIdentifier, attributes)

    if (children.length) {
      const endIdentifier = Object.assign({}, jsxIdentifier, {comments: []})
      // Add text newline nodes between elements so recast formats one child per
      // line instead of all children on one line.
      const paddedChildren = [j.jsxText('\n')]
      for (const child of children) {
        paddedChildren.push(child, j.jsxText('\n'))
      }
      const element = j.jsxElement(openingElement, j.jsxClosingElement(endIdentifier), paddedChildren)
      element.comments = comments
      return element
    } else {
      openingElement.selfClosing = true
      const element = j.jsxElement(openingElement)
      element.comments = comments
      return element
    }
  }

  const jsxCode = j(toCreateElement)
    .find(j.CallExpression, {
      callee: {
        object: {
          name: 'React'
        },
        property: {
          name: 'createElement'
        }
      }
    })
    .replaceWith(convertNodeToJSX)
    .toSource()

  return jsxCode
}

function removeParamsFromRender({j, path}) {
  let fnPath = path
  if (fnPath === null) return

  if (fnPath.node.type === j.Property.name) {
    fnPath = fnPath.get('value')
    if (fnPath.node.type !== j.FunctionExpression.name) {
      throw new Error('Given node path does not resolve to a function.')
    }
  }

  if (fnPath.node.params.length === 0) return

  if (fnPath.node.params.length > 1) {
    throw new Error('More than one parameter was passed to the render function.')
  }

  const parameter = fnPath.get('params', 0)
  j(parameter).remove()
}

function removeDomDestructuresFromFunction({j, path}) {
  j(path)
    .find(j.VariableDeclaration, {
      declarations: [
        {
          id: {type: j.ObjectPattern.name},
          init: {name: 'DOM', type: j.Identifier.name},
          type: j.VariableDeclarator.name
        }
      ]
    })
    .forEach(declaration => {
      j(declaration).remove()
    })

  j(path)
    .find(j.VariableDeclarator, {
      id: {type: j.ObjectPattern.name},
      init: {
        object: {name: 'React'},
        property: {name: 'DOM'},
        type: j.MemberExpression.name
      }
    })
    .forEach(declarator => {
      j(declarator).remove()
    })
}

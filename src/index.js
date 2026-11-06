import defineClassComponent, { VueComponent } from './class-adapter'
import defineFunctionComponent, { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useReducer, useContext, useProvide } from './function-adapter'

export { VueComponent, defineClassComponent, defineFunctionComponent, useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useReducer, useContext, useProvide }

export default {
    defineClassComponent,
    defineFunctionComponent,
}

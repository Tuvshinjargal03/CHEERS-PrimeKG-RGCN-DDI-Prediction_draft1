import { Info } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import './InfoTooltip.css'

const VIEWPORT_MARGIN = 12
const TOOLTIP_GAP = 8
const MAX_TOOLTIP_WIDTH = 280

function InfoTooltip({ text, label = 'View explanatory note', placement = 'top' }) {
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)
  const tooltipId = useId()
  const isOpen = isHovered || isFocused || isPinned

  function close() {
    setIsHovered(false)
    setIsFocused(false)
    setIsPinned(false)
  }

  useEffect(() => {
    if (!isOpen) return undefined

    function closeIfOutside(event) {
      if (!rootRef.current?.contains(event.target)) close()
    }

    document.addEventListener('pointerdown', closeIfOutside)
    return () => document.removeEventListener('pointerdown', closeIfOutside)
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) return undefined

    function positionTooltip() {
      const trigger = triggerRef.current
      const tooltip = tooltipRef.current
      if (!trigger || !tooltip) return

      const triggerRect = trigger.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = document.documentElement.clientHeight
      const tooltipWidth = Math.min(
        MAX_TOOLTIP_WIDTH,
        viewportWidth - (VIEWPORT_MARGIN * 2),
      )

      tooltip.style.width = `${tooltipWidth}px`
      const tooltipHeight = Math.min(
        tooltip.offsetHeight,
        viewportHeight - (VIEWPORT_MARGIN * 2),
      )
      const roomAbove = triggerRect.top - VIEWPORT_MARGIN
      const roomBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN
      let resolvedPlacement = placement

      if (placement === 'top' && roomAbove < tooltipHeight + TOOLTIP_GAP && roomBelow > roomAbove) {
        resolvedPlacement = 'bottom'
      } else if (placement === 'bottom' && roomBelow < tooltipHeight + TOOLTIP_GAP && roomAbove > roomBelow) {
        resolvedPlacement = 'top'
      }

      const centeredLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipWidth / 2)
      const left = Math.min(
        viewportWidth - tooltipWidth - VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, centeredLeft),
      )
      const preferredTop = resolvedPlacement === 'bottom'
        ? triggerRect.bottom + TOOLTIP_GAP
        : triggerRect.top - tooltipHeight - TOOLTIP_GAP
      const top = Math.min(
        viewportHeight - tooltipHeight - VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, preferredTop),
      )

      tooltip.style.left = `${left}px`
      tooltip.style.top = `${top}px`
      tooltip.dataset.placement = resolvedPlacement
    }

    positionTooltip()
    window.addEventListener('resize', positionTooltip)
    window.addEventListener('scroll', positionTooltip, true)
    return () => {
      window.removeEventListener('resize', positionTooltip)
      window.removeEventListener('scroll', positionTooltip, true)
    }
  }, [isOpen, placement, text])

  return (
    <span
      ref={rootRef}
      className="info-tooltip"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className="info-tooltip-trigger"
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          setIsPinned(false)
        }}
        onClick={() => {
          if (isPinned) {
            setIsPinned(false)
            setIsFocused(false)
          } else {
            setIsPinned(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          close()
          triggerRef.current?.focus()
        }}
      >
        <Info size={13} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {isOpen && (
        <span ref={tooltipRef} id={tooltipId} className="info-tooltip-content" role="tooltip">
          {text}
        </span>
      )}
    </span>
  )
}

export default InfoTooltip

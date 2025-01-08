"use client";
import React from "react";
import { useGongoOne, useGongoUserId } from "gongo-client-react";
import { signIn, signOut } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

import {
  AppBar,
  Avatar,
  Toolbar,
  Typography,
  IconButton,
  MenuItem,
  Menu,
  InputBase,
  Box,
  InputAdornment,
  Drawer,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Collapse,
  useScrollTrigger,
  Slide,
} from "@mui/material";
import {
  AccountCircle,
  Login,
  Menu as MenuIcon,
  Share,
  Search as SearchIcon,
  Close,
  ExpandLess,
  ExpandMore,
  ArrowDropDown,
  ArrowDropUp,
} from "@mui/icons-material";

// import Link from "@/lib/link";
import db, { enableNetwork } from "@/db";
import pathnames, { PathnameValue } from "./pathnames";
import NextLink from "next/link";
// import { SITE_TITLE } from "@/api-lib/consts";
const SITE_TITLE = "Magick.ly";

function usePathnameInfo() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navParts: { title: string; url: string }[] = [];
  if (!pathname) return { title: SITE_TITLE, navParts };
  // if (pathnames[pathname]) return { title: pathnames[pathname], navParts };

  let navPath = "";

  let value: typeof pathnames | PathnameValue | string = pathnames;
  const parts = pathname.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    value = value[part];
    if (typeof value === "string") break;
    if (i === parts.length - 1) break;
    if (value === undefined) break;
    navPath += "/" + part;
    navParts.push({ url: navPath, title: value["/"] });
  }

  if (typeof value === "function")
    value = value({ pathname, searchParams }) as string;
  else if (value === undefined) value = SITE_TITLE;
  else if (typeof value === "object") value = value["/"];

  return { navParts, title: value as unknown as string };
}

function HideOnScroll({ children }) {
  const trigger = useScrollTrigger();

  return (
    <Slide appear={false} direction="down" in={!trigger}>
      {children ?? <div />}
    </Slide>
  );
}

export function UserAvatar({
  sx,
}: {
  sx?: Parameters<typeof Avatar>[0]["sx"];
}) {
  const userId = useGongoUserId();
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId })
  );
  const avatarSrc = (user?.image as string) || user?.photos?.[0]?.value;

  return avatarSrc ? (
    <Avatar
      alt={typeof user?.displayName === "string" ? user.displayName : "avatar"}
      src={avatarSrc}
      sx={sx}
      slotProps={{
        img: {
          referrerPolicy: "no-referrer",
        },
      }}
    />
  ) : (
    <Avatar sx={sx}>
      <AccountCircle />
    </Avatar>
  );
}

function MenuDrawer({
  handleDrawerToggle,
}: {
  handleDrawerToggle: () => void;
}) {
  const [open, setOpen] = React.useState("");

  return (
    <Box onClick={handleDrawerToggle}>
      <Typography variant="h6" sx={{ my: 2, mx: 2, textAlign: "left" }}>
        <Image
          src="/pentagram.png"
          alt="Pentagram"
          width={32}
          height={32}
          style={{ verticalAlign: "middle", marginRight: 12 }}
        />
        <span style={{ verticalAlign: "middle" }}>Magick.ly</span>
      </Typography>
      <Divider />
      <List>
        {Object.entries(pathnames)
          .filter(([key, value]) => {
            // TODO, hooks to check access.
            if (key === "admin") return false;
            return true;
          })
          .map(([key, value]) =>
            typeof value === "string" || Object.keys(value).length === 2 ? (
              <ListItem key={key} disablePadding>
                <ListItemButton
                  component={Link}
                  href={key === "/" ? "/" : "/" + key}
                >
                  <ListItemText
                    primary={
                      value === "Magick.ly"
                        ? "Home"
                        : typeof value === "string"
                        ? value
                        : value["/"]
                    }
                  />
                </ListItemButton>
              </ListItem>
            ) : (
              <React.Fragment key={key}>
                <ListItemButton
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(key === open ? "" : key);
                  }}
                >
                  <ListItemText primary={value["/"]} />
                  {open === key ? <ExpandLess /> : <ExpandMore />}
                </ListItemButton>
                <Collapse in={open === key} timeout="auto" unmountOnExit>
                  <List component="div" disablePadding>
                    {Object.entries(value)
                      .filter(([key, value]) => {
                        if (key === "/") return false;
                        // if (typeof value !== "string") return false;
                        return true;
                      })
                      .map(([key2, value]) => (
                        <ListItemButton
                          key={key2}
                          sx={{ pl: 4 }}
                          component={Link}
                          href={"/" + key + (key2 === "/" ? "" : "/" + key2)}
                        >
                          <ListItemText
                            primary={
                              typeof value === "string" ? value : value["/"]
                            }
                          />
                        </ListItemButton>
                      ))}
                  </List>
                </Collapse>
              </React.Fragment>
            )
          )}
      </List>
    </Box>
  );
}

export default function ButtonAppBar() {
  const { title, navParts } = usePathnameInfo();
  const [search, setSearch] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const userId = useGongoUserId();
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId })
  );
  const avatarSrc = user?.image || user?.photos?.[0]?.value;
  const network = useGongoOne((db) => db.gongoStore.find({ _id: "network" }));

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [navAnchorEl, setNavAnchorEl] = React.useState<null | HTMLElement>(
    null
  );

  const handleUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserClose = () => {
    setAnchorEl(null);
  };

  const handleDrawerToggle = () => {
    setDrawerOpen(!drawerOpen);
  };

  // console.log(navParts);

  function share() {
    const data = {
      title: title + " - magick.ly",
      text:
        'Check out "' + title + '" on magick.ly, the open source magick app!',
      url: window.location.href,
    };

    //console.log({ data });

    if (navigator.share)
      navigator
        .share(data)
        .catch((error) => alert("Error sharing. " + JSON.stringify(error)));
    else alert("Sharing not supported on this platform.");
  }

  return (
    <div>
      <HideOnScroll>
        <AppBar>
          <Toolbar disableGutters={true} sx={{ px: 2 }}>
            <IconButton
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 0.5 }}
              onClick={handleDrawerToggle}
            >
              <MenuIcon />
            </IconButton>
            <Typography
              variant="h6"
              component="div"
              sx={{
                flexGrow: 1,
                display: "inline-block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                height: "1.5em",
                whiteSpace: "nowrap",
              }}
            >
              {navParts && navParts.length ? (
                <>
                  <div onClick={(e) => setNavAnchorEl(e.currentTarget)}>
                    <span style={{ verticalAlign: "top" }}>{title}</span>
                    {navAnchorEl ? (
                      <ArrowDropUp
                        sx={{ verticalAlign: "bottom", marginBottom: 0.5 }}
                      />
                    ) : (
                      <ArrowDropDown
                        sx={{ verticalAlign: "bottom", marginBottom: 0.5 }}
                      />
                    )}
                  </div>
                  <Menu
                    id="nav-menu"
                    anchorEl={navAnchorEl}
                    open={Boolean(navAnchorEl)}
                    onClose={() => setNavAnchorEl(null)}
                    anchorOrigin={{
                      vertical: "bottom",
                      horizontal: "left",
                    }}
                    transformOrigin={{
                      vertical: "top",
                      horizontal: "left",
                    }}
                    sx={{ marginTop: 0.5, marginLeft: -1.8 }}
                  >
                    {navParts.map((part, i) => (
                      <MenuItem
                        key={part.url}
                        onClick={() => {
                          setNavAnchorEl(null);
                        }}
                      >
                        <NextLink
                          href={part.url}
                          style={{
                            color: "inherit",
                            textDecoration: "none",
                            paddingLeft: 9 * i,
                          }}
                        >
                          {part.title}
                        </NextLink>
                      </MenuItem>
                    ))}
                    <MenuItem
                      onClick={() => {
                        setNavAnchorEl(null);
                      }}
                    >
                      <span
                        style={{
                          paddingLeft: 9 * navParts.length,
                          color: "red",
                        }}
                      >
                        {title}
                      </span>
                    </MenuItem>
                  </Menu>
                </>
              ) : (
                title
              )}
            </Typography>
            <div
              // Container for search, share and user buttons.
              style={{
                display: "inline-block",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  width: 25,
                  paddingLeft: 8,
                  paddingRight: 8,
                }}
              >
                <Box
                  // Could try merge this with below.
                  sx={{
                    display: "block",
                    position: "absolute",
                    // top: 6,
                    marginTop: -3.1,
                    // This will get much easier once CSS anchor() is baseline
                    // Each is width 25 + padding 16 = 41, x2 = 82
                    right: 82 + 16 + (avatarSrc ? 20 : 0),
                    left: searchOpen
                      ? 14
                      : "calc(100% - 82px - 16px - 25px - 16px - 16px" +
                        (avatarSrc ? " - 20px" : "") +
                        ")",
                    transition: "left 0.5s, background 0.2s",
                    background: searchOpen ? "#80a6f1" : undefined,
                    "&:hover": {
                      background: "#80a6f1",
                    },
                    borderRadius: 3,
                  }}
                >
                  <InputBase
                    id="searchInput"
                    placeholder="Coming soon…"
                    inputProps={{ "aria-label": "search" }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => !searchOpen && setSearchOpen(true)}
                    onBlur={() => searchOpen && setSearchOpen(false)}
                    sx={{
                      paddingTop: 0.5,
                      paddingBottom: 0.5,
                      paddingLeft: 1,
                      color: "white",
                      width: "100%",
                    }}
                    endAdornment={
                      <InputAdornment position="end">
                        <IconButton
                          sx={{
                            color: "white",
                            // pointerEvents: searchOpen ? "auto" : "none",
                          }}
                          aria-label="toggle search box"
                          onClick={(e) => {
                            setSearchOpen(!searchOpen);
                            if (!searchOpen) {
                              document.getElementById("searchInput")?.focus();
                            }
                          }}
                        >
                          {searchOpen ? <Close /> : <SearchIcon />}
                        </IconButton>
                      </InputAdornment>
                    }
                  />
                </Box>
              </div>
              <IconButton color="inherit" aria-label="share" onClick={share}>
                <Share />
              </IconButton>
              {userId ? (
                <span>
                  <IconButton
                    aria-label="account of current user"
                    aria-controls="menu-appbar"
                    aria-haspopup="true"
                    onClick={handleUserMenu}
                    color="inherit"
                  >
                    <UserAvatar />
                  </IconButton>
                  <Menu
                    id="menu-appbar"
                    anchorEl={anchorEl}
                    anchorOrigin={{
                      vertical: "top",
                      horizontal: "right",
                    }}
                    keepMounted
                    transformOrigin={{
                      vertical: "top",
                      horizontal: "right",
                    }}
                    open={Boolean(anchorEl)}
                    onClose={handleUserClose}
                  >
                    <MenuItem
                      onClick={() => {
                        signOut();
                        handleUserClose();
                      }}
                    >
                      Logout
                    </MenuItem>
                  </Menu>
                </span>
              ) : (
                <IconButton
                  sx={{ color: "white" }}
                  onClick={() => {
                    if (!network) enableNetwork();
                    signIn();
                  }}
                >
                  <Login />
                </IconButton>
              )}
            </div>
          </Toolbar>
        </AppBar>
      </HideOnScroll>
      <nav>
        <Drawer
          variant="temporary"
          open={drawerOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: 250,
            },
          }}
        >
          <MenuDrawer handleDrawerToggle={handleDrawerToggle} />
        </Drawer>
      </nav>
    </div>
  );
}
